const OPENWEATHER_API_KEY = "ed470b4576f97b282cc57fb80f08dd21"; // Replace with your OpenWeather API Key
const ORS_API_KEY = "5b3ce3597851110001cf62482f69e87783d04922ac1263a65d94b7fe"; // Replace with your OpenRouteService API Key

const map = L.map('map').setView([0, 0], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

let userMarker, routeLayer, parkingLayer;
let mute = false;
let customParkingSpots = JSON.parse(localStorage.getItem('customParkingSpots')) || [];

// Custom parking icon
const customParkingIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/484/484167.png', // Replace with your custom icon URL
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
});

// Fetch Weather Data
async function fetchWeather(latitude, longitude, elementId) {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${OPENWEATHER_API_KEY}&units=metric`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        document.getElementById(elementId).textContent =
            `${data.weather[0].description}, ${data.main.temp}°C`;
        document.getElementById(elementId + "-icon").src =
            `https://openweathermap.org/img/wn/${data.weather[0].icon}.png`;

        checkWeatherConditions(data);
    } catch (error) {
        console.error("Weather API Error:", error);
    }
}

// Weather Warnings
function checkWeatherConditions(weatherData) {
    if (weatherData.wind.speed > 10) {
        alert("⚠️ Strong winds detected! Ride cautiously.");
    }
    if (weatherData.weather[0].main === "Rain") {
        alert("🌧️ Rain detected! Ride safely.");
    }
}

// Get Coordinates for Place Name
async function getCoordinates(place) {
    if (place.includes(',')) {
        return place.split(',').map(Number);
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(place)}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.length === 0) throw new Error("Location not found.");
    return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
}

// Fetch suggestions from Nominatim API
async function fetchSuggestions(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
    const response = await fetch(url);
    const data = await response.json();
    
    return data.map(item => ({
        name: item.display_name,
        coords: [parseFloat(item.lat), parseFloat(item.lon)],
    }));
}

// Setup Autocomplete for Destination Input
function setupAutocomplete() {
    const destinationInput = document.getElementById('destination');
    const suggestionsContainer = document.getElementById('destination-suggestions');

    destinationInput.addEventListener('input', async () => {
        const query = destinationInput.value;
        
        if (query.length < 3) {
            suggestionsContainer.innerHTML = ''; // Clear suggestions if input is short
            return;
        }

        // Fetch suggestions from Nominatim API
        const suggestions = await fetchSuggestions(query);

        // Display suggestions in the dropdown
        suggestionsContainer.innerHTML = suggestions.map(
            suggestion => `<div class="suggestion-item" data-lat="${suggestion.coords[0]}" data-lon="${suggestion.coords[1]}">${suggestion.name}</div>`
        ).join('');

        // Handle click event on a suggestion
        document.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                destinationInput.value = item.textContent;  // Fill input with the selected place
                destinationInput.dataset.lat = item.getAttribute('data-lat');  // Store latitude
                destinationInput.dataset.lon = item.getAttribute('data-lon');  // Store longitude
                suggestionsContainer.innerHTML = ''; // Hide suggestions
            });
        });
    });
}

// Call function to activate autocomplete
setupAutocomplete();

// Calculate Route using OpenRouteService
async function calculateRoute() {
    const originInput = document.getElementById('origin').value;
    const destinationInput = document.getElementById('destination');

    if (!originInput || !destinationInput.value) {
        alert("Please enter both origin and destination.");
        return;
    }

    let originCoords;
    if (originInput === 'your-location') {
        if (!userMarker) {
            alert("Your location is not available.");
            return;
        }
        originCoords = [userMarker.getLatLng().lat, userMarker.getLatLng().lng];
    } else {
        originCoords = await getCoordinates(originInput);
    }

    const destinationCoords = [destinationInput.dataset.lat, destinationInput.dataset.lon];

    if (routeLayer) map.removeLayer(routeLayer);

    const routeUrl = `https://api.openrouteservice.org/v2/directions/cycling-regular?api_key=${ORS_API_KEY}&start=${originCoords[1]},${originCoords[0]}&end=${destinationCoords[1]},${destinationCoords[0]}`;

    try {
        const response = await fetch(routeUrl);
        const data = await response.json();
        const coordinates = data.features[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
        const instructions = data.features[0].properties.segments[0].steps;

        // Draw route
        routeLayer = L.polyline(coordinates, { color: 'blue', weight: 5 }).addTo(map);
        map.fitBounds(routeLayer.getBounds());
        speakText("Route calculated. Follow the blue line.");
        document.getElementById('start').style.display = 'inline-block';

        // Fetch weather for source and destination
        fetchWeather(originCoords[0], originCoords[1], 'source-weather');
        fetchWeather(destinationCoords[0], destinationCoords[1], 'destination-weather');

        // Start navigation with step-by-step instructions
        startLiveTracking(destinationCoords, instructions);
    } catch (error) {
        alert("Failed to calculate route.");
        console.error(error);
    }
}

// Start Live Tracking
function startLiveTracking(destinationCoords, instructions) {
    let currentStep = 0;

    document.getElementById('start').addEventListener('click', () => {
        if (currentStep < instructions.length) {
            const instruction = instructions[currentStep];
            speakText(instruction.instruction);
            currentStep++;
        } else {
            speakText("You have reached your destination.");
        }
    });
}

// Locate Nearby Parking using Overpass API and Custom Parking Spots
async function locateParking() {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        const url = `https://overpass-api.de/api/interpreter?data=[out:json];node[amenity=parking](around:1000,${latitude},${longitude});out;`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (parkingLayer) map.removeLayer(parkingLayer);
            parkingLayer = L.layerGroup();

            // Add existing parking spots
            if (data.elements.length > 0) {
                data.elements.forEach(({ lat, lon }) => {
                    L.marker([lat, lon]).bindPopup("Parking Area").addTo(parkingLayer);
                });
            }

            // Add custom parking spots
            customParkingSpots.forEach(({ lat, lon }) => {
                L.marker([lat, lon], { icon: customParkingIcon }).bindPopup("Custom Parking Area").addTo(parkingLayer);
            });

            parkingLayer.addTo(map);
            speakText("Nearby parking areas marked on the map.");
            alert("Parking is available nearby!");
        } catch (error) {
            alert("Could not locate parking areas.");
            console.error("Parking Detection Error:", error);
        }
    });
}

// Add Custom Parking Spot
document.getElementById('add-parking').addEventListener('click', () => {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }

    navigator.geolocation.getCurrentPosition((position) => {
        const { latitude, longitude } = position.coords;
        customParkingSpots.push({ lat: latitude, lon: longitude });
        localStorage.setItem('customParkingSpots', JSON.stringify(customParkingSpots));
        alert("Custom parking spot added!");
    });
});

// Detect Parking Space using YOLOv8
async function detectParkingSpace() {
    const video = document.getElementById("video");
    const cameraView = document.getElementById("camera-view");

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { exact: "environment" } // Request the main (rear-facing) camera
            }
        })
        .then((stream) => {
            cameraView.style.display = "block";
            video.srcObject = stream;

            setTimeout(() => {
                const isSuitable = Math.random() > 0.5; // Mock detection
                alert(isSuitable ? "You can park here." : "Choose another place.");
                stream.getTracks().forEach((track) => track.stop());
                cameraView.style.display = "none";
            }, 3000);
        })
        .catch((error) => {
            console.error("Error accessing camera:", error);
            alert("Camera access denied or no suitable camera available.");
        });
    } else {
        alert("Your device does not support camera access.");
    }
}

// Voice Output
function speakText(text) {
    if (mute) return;
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    synth.speak(utterance);
}

// Mute Button Functionality
document.getElementById('mute').addEventListener('click', () => {
    mute = !mute;
    document.getElementById('mute').textContent = mute ? 'Unmute' : 'Mute';
    speakText(mute ? "Voice guidance muted" : "Voice guidance unmuted");
});

// Initialize Current Location
function initializeCurrentLocation() {
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            fetchWeather(latitude, longitude, 'weather-text');

            map.setView([latitude, longitude], 15);
            userMarker = L.marker([latitude, longitude])
                .addTo(map)
                .bindPopup("You are here")
                .openPopup();

            document.getElementById('location-display').textContent = 
                `Current Location: Latitude ${latitude.toFixed(5)}, Longitude ${longitude.toFixed(5)}`;
        },
        () => alert("Could not fetch your location."),
        { enableHighAccuracy: true }
    );
}
let objectModel;

// Load COCO-SSD model
async function loadObjectModel() {
    objectModel = await cocoSsd.load();
    console.log("✅ Object Detection Model Loaded!");
}
loadObjectModel();

// Function to check if a back camera is available
async function checkBackCamera() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some(device => device.kind === "videoinput" && device.label.toLowerCase().includes("back"));
}

// Start Object Detection (Back Camera Only)
async function startObjectDetection() {
    const video = document.getElementById("object-video");
    const canvas = document.getElementById("object-canvas");
    const alertText = document.getElementById("object-alert");
    const view = document.getElementById("object-detection-view");

    view.style.display = "block";

    // Check if back camera is available
    const hasBackCamera = await checkBackCamera();
    if (!hasBackCamera) {
        alertText.textContent = "❌ This device does not support a back camera.";
        return;
    }

    try {
        // Access only the back camera
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: "environment" } } });
        video.srcObject = stream;

        // Ensure video is loaded before starting detection
        video.onloadedmetadata = () => {
            video.play();
            detectObjects(video, canvas, alertText);
        };
    } catch (error) {
        console.error("Camera Error:", error);
        alertText.textContent = "❌ Unable to access the back camera.";
    }
}

// Perform Object Detection
async function detectObjects(video, canvas, alertText) {
    const ctx = canvas.getContext("2d");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    async function detect() {
        if (!objectModel) {
            console.error("⚠️ Object detection model not loaded yet!");
            return;
        }

        // Detect objects in video frame
        const predictions = await objectModel.detect(video);

        // Clear previous drawings
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw video frame
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        let warningMessage = "";

        predictions.forEach((prediction) => {
            const [x, y, width, height] = prediction.bbox;

            // Identify vehicles and persons
            if (["car", "truck", "bus", "motorbike", "person"].includes(prediction.class)) {
                // Set color based on object type
                ctx.strokeStyle = prediction.class === "person" ? "blue" : "red";
                ctx.lineWidth = 4;
                ctx.strokeRect(x, y, width, height);

                // Display label
                ctx.fillStyle = prediction.class === "person" ? "blue" : "red";
                ctx.font = "18px Arial";
                ctx.fillText(prediction.class, x, y > 20 ? y - 5 : y + 15);

                // Alert conditions based on bounding box size
                const personCloseRange = 150;
                const vehicleCloseRange = 100;

                if (prediction.class === "person" && width > personCloseRange) {
                    warningMessage = "⚠️ Warning! Person too close!";
                    speakText(warningMessage);
                }

                if (["car", "truck", "bus", "motorbike"].includes(prediction.class) && width > vehicleCloseRange) {
                    warningMessage = "⚠️ Warning! Vehicle detected too close!";
                    speakText(warningMessage);
                }
            }
        });

        // Show alert box
        alertText.textContent = warningMessage || "✅ No immediate threats detected.";

        // Run detection continuously
        requestAnimationFrame(detect);
    }

    detect();
}

// Function to provide voice alerts
function speakText(text) {
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    synth.speak(utterance);
}

// Attach event listener to Start Object Detection button
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("detect-back").addEventListener("click", startObjectDetection);
});




// Event Listeners
document.getElementById('navigate').addEventListener('click', calculateRoute);
document.getElementById('locate-parking').addEventListener('click', locateParking);
document.getElementById('detect-parking').addEventListener('click', detectParkingSpace);
initializeCurrentLocation();