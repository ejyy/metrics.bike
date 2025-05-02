// Metrics.bike
import Auth from "./auth.js";
import fitDecoder from "https://cdn.jsdelivr.net/npm/fit-decoder/+esm";

// Constants
const apiEndpoint = "https://api.wahooligan.com/v1/workouts";
const numActivities = 10;

// DOM Elements
const loginButton = document.getElementById("login-button");
const refreshButton = document.getElementById("refresh-button");
const logoutButton = document.getElementById("logout-button");
const activitiesSection = document.getElementById("activities-section");
const loginSection = document.getElementById("login-section");
const activitiesContainer = document.getElementById("activities-container");
const statusElement = document.getElementById("status");

// Helper Functions
function showStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.className = isError ? "error" : "success";
  statusElement.classList.remove("hidden");
}

function hideStatus() {
  statusElement.classList.add("hidden");
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

// Calculate average watts from power data
function calculateAvgWatts(powerArray) {
  if (!powerArray || powerArray.length === 0) return null;
  const validValues = powerArray.filter((value) => value > 0);
  if (validValues.length === 0) return null;
  return Math.round(
    validValues.reduce((a, b) => a + b, 0) / validValues.length,
  );
}

function calculateNormalizedPower(powerArray) {
  if (!powerArray || powerArray.length === 0) return null;
  
  // Use 30-second rolling average (assuming 1 second samples)
  const windowSize = 30;
  const rollingAvgs = [];
  
  for (let i = 0; i <= powerArray.length - windowSize; i++) {
    const window = powerArray.slice(i, i + windowSize);
    const avg = window.reduce((sum, val) => sum + val, 0) / windowSize;
    rollingAvgs.push(avg);
  }
  
  // Calculate the fourth power of each 30s rolling average
  const fourthPowers = rollingAvgs.map(avg => Math.pow(avg, 4));
  
  // Calculate the average of the fourth powers
  const avgFourthPower = fourthPowers.reduce((sum, val) => sum + val, 0) / fourthPowers.length;
  
  // Take the fourth root of the average
  const normalizedPower = Math.pow(avgFourthPower, 0.25);
  
  return Math.round(normalizedPower);
}

// Calculate best power efforts for specified durations
function calculateBestEfforts(powerArray) {
  if (!powerArray || powerArray.length === 0) return null;
  
  // Define durations (in seconds)
  const durations = {
    '5s': 5,
    '1m': 60,
    '5m': 300,
    '20m': 1200
  };
  
  const bestEfforts = {};
  
  // Calculate for each duration
  for (const [key, duration] of Object.entries(durations)) {
    // Skip if we don't have enough data points
    if (powerArray.length < duration) {
      bestEfforts[key] = null;
      continue;
    }
    
    let maxAvg = 0;
    
    // Calculate the best average power for the current duration
    for (let i = 0; i <= powerArray.length - duration; i++) {
      const window = powerArray.slice(i, i + duration);
      const avg = window.reduce((sum, val) => sum + val, 0) / duration;
      
      if (avg > maxAvg) {
        maxAvg = avg;
      }
    }
    
    bestEfforts[key] = Math.round(maxAvg);
  }
  
  return bestEfforts;
}

// Parse FIT file and extract power data
async function parsePowerData(url) {
  if (!url) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch FIT file");

    const arrayBuffer = await response.arrayBuffer();
    const jsonRaw = fitDecoder.fit2json(arrayBuffer);
    const json = await fitDecoder.parseRecords(jsonRaw);
    return fitDecoder.getRecordFieldValue(json, "record", "power");
  } catch (error) {
    console.error("Error parsing FIT file:", error);
    return null;
  }
}

// Fetch and process activities
async function fetchActivities() {
  try {
    const token = await Auth.getAccessToken();
    if (!token) {
      showStatus("Not authenticated. Please log in again.", true);
      activitiesSection.classList.add("hidden");
      loginSection.classList.remove("hidden");
      return;
    }

    showStatus("Fetching your activities...");

    // First, fetch the list of workouts
    const response = await fetch(`${apiEndpoint}?per_page=${numActivities}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    const activities = data.items || data.workouts || data;

    if (!Array.isArray(activities)) {
      throw new Error("Unexpected API response format");
    }

    // Process activities and filter cycling with power
    const processedActivities = [];

    // For each activity, fetch its workout summary to get the FIT file URL
    for (const activity of activities) {
      try {
        // Fetch the workout summary for this activity
        const summaryResponse = await fetch(`${apiEndpoint}/${activity.id}/workout_summary`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!summaryResponse.ok) continue;

        const summaryData = await summaryResponse.json();
        const fitFileUrl = summaryData.file?.url;

        if (!fitFileUrl) continue;

        const powerArray = await parsePowerData(fitFileUrl);
        if (!powerArray || powerArray.length === 0) continue;

        const avgWatts = calculateAvgWatts(powerArray);
        const normalizedPower = calculateNormalizedPower(powerArray);
        const bestEfforts = calculateBestEfforts(powerArray);
        
        if (!avgWatts) continue;
        
        // Merge the activity data with the summary data
        processedActivities.push({
          ...activity,
          workout_summary: summaryData,
          avgWatts,
          normalizedPower,
          bestEfforts
        });
      } catch (error) {
        console.error(`Error processing activity ${activity.id}:`, error);
      }
    }

    // Display activities
    displayActivities(processedActivities);
    hideStatus();
    activitiesSection.classList.remove("hidden");
  } catch (error) {
    showStatus("Failed to fetch activities: " + error.message, true);
  }
}

// Display activities
function displayActivities(activities) {
  activitiesContainer.innerHTML = "";
  if (!activities || activities.length === 0) {
    activitiesContainer.innerHTML =
      "<p>No cycling activities with power data found.</p>";
    return;
  }
  activities.forEach((activity) => {
    const activityElement = document.createElement("div");
    activityElement.className = "activity";
    const activityName = activity.name
      ? activity.name.charAt(0).toUpperCase() + activity.name.slice(1)
      : "Unknown";
    const startDate = activity.starts
      ? formatDate(activity.starts)
      : "Unknown date";
    const duration = activity.minutes
      ? formatDuration(activity.minutes)
      : "Unknown duration";
    const distance = activity.workout_summary?.distance_accum
      ? (activity.workout_summary.distance_accum / 1000).toFixed(2) + " km"
      : "Unknown distance";
    
    // Format best efforts output
    let bestEffortsHTML = '';
    if (activity.bestEfforts) {
      bestEffortsHTML = `
        <div class="best-efforts">
          <h4>Best Power Efforts:</h4>
          <ul>
            ${activity.bestEfforts['5s'] ? `<li><strong>5s:</strong> ${activity.bestEfforts['5s']} watts</li>` : ''}
            ${activity.bestEfforts['1m'] ? `<li><strong>1m:</strong> ${activity.bestEfforts['1m']} watts</li>` : ''}
            ${activity.bestEfforts['5m'] ? `<li><strong>5m:</strong> ${activity.bestEfforts['5m']} watts</li>` : ''}
            ${activity.bestEfforts['20m'] ? `<li><strong>20m:</strong> ${activity.bestEfforts['20m']} watts</li>` : ''}
          </ul>
        </div>
      `;
    }
    
    activityElement.innerHTML = `
      <h3>${activityName} - ${startDate}</h3>
      <p><strong>Duration:</strong> ${duration}</p>
      <p><strong>Distance:</strong> ${distance}</p>
      ${activity.workout_summary?.calories_accum ? `<p><strong>Calories:</strong> ${activity.workout_summary.calories_accum} kcal</p>` : ""}
      ${activity.workout_summary?.heart_rate_avg ? `<p><strong>Avg Heart Rate:</strong> ${activity.workout_summary.heart_rate_avg} bpm</p>` : ""}
      ${activity.workout_summary?.speed_avg ? `<p><strong>Avg Speed:</strong> ${(activity.workout_summary.speed_avg * 3.6).toFixed(1)} km/h</p>` : ""}
      <div class="power-data">
        <p><strong>Average Power:</strong> ${activity.avgWatts} watts</p>
        ${activity.normalizedPower ? `<p><strong>Normalized Power:</strong> ${activity.normalizedPower} watts</p>` : ""}
        ${bestEffortsHTML}
      </div>
    `;
    activitiesContainer.appendChild(activityElement);
  });
}

// Event handlers
async function init() {
  const authResult = await Auth.handleAuthRedirect();

  if (authResult.authenticated) {
    loginSection.classList.add("hidden");
    await fetchActivities();
  } else if (authResult.error) {
    showStatus("Authentication error: " + authResult.error, true);
  }
}

// Event Listeners
loginButton.addEventListener("click", Auth.initiateAuth);
refreshButton.addEventListener("click", fetchActivities);
logoutButton.addEventListener("click", () => {
  Auth.logout();
  activitiesSection.classList.add("hidden");
  loginSection.classList.remove("hidden");
});
window.addEventListener("load", init);
