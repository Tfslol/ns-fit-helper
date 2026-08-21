// @ts-check

import { renderSessionResults } from "./session-results.js";

/**
 * @typedef {{ fccId: string, fccName: string }} FccLocation
 * @typedef {{ fccId: string, fccName: string, dateTimeStart: string, vacancyDisplay: string, trgType: string }} SessionResponse
 * @typedef {{ fccName: string, dateTimeStart: string, trgType: string }} PopupBookingResponse
 * @typedef {{ success: boolean, error?: string, slots?: SessionResponse[], bookings?: PopupBookingResponse[] }} OptionsResponse
 */

/** @type {FccLocation[]} */
let allLocations = [];
/** @type {Set<string>} */
let preferredIds = new Set();
/** @type {string} */
let searchQuery = "";

/**
 * Days of week that are BLOCKED (0=Sun ... 6=Sat).
 * @type {Set<number>}
 */
let blockedDays = new Set();

/**
 * Specific calendar dates that are BLOCKED, stored as "YYYY-MM-DD" strings.
 * @type {Set<string>}
 */
let blockedDates = new Set();

// ---- DOM refs ----------------------------------------------------------------
const preferredList = /** @type {HTMLElement} */ (document.getElementById("preferredList"));
const notPreferredList = /** @type {HTMLElement} */ (document.getElementById("notPreferredList"));
const prefCount = /** @type {HTMLElement} */ (document.getElementById("prefCount"));
const notPrefCount = /** @type {HTMLElement} */ (document.getElementById("notPrefCount"));
const locStatus = /** @type {HTMLElement} */ (document.getElementById("locStatus"));
const cacheStatus = /** @type {HTMLElement} */ (document.getElementById("cacheStatus"));
const refreshBtn = /** @type {HTMLButtonElement} */ (document.getElementById("refreshBtn"));
const searchBox = /** @type {HTMLInputElement} */ (document.getElementById("searchBox"));
const fetchOptionsBtn = /** @type {HTMLButtonElement} */ (document.getElementById("fetchOptionsBtn"));
const resultsBox = /** @type {HTMLElement} */ (document.getElementById("resultsBox"));
const urlDisplay = /** @type {HTMLElement} */ (document.getElementById("urlDisplay"));
const urlVal = /** @type {HTMLElement} */ (document.getElementById("urlVal"));
const optionsError = /** @type {HTMLElement} */ (document.getElementById("optionsError"));
const dateFromInput = /** @type {HTMLInputElement} */ (document.getElementById("dateFrom"));
const dateToInput = /** @type {HTMLInputElement} */ (document.getElementById("dateTo"));
// Filters tab
const dayCheckboxes = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll(".day-checkbox"));
const blockedDateInput = /** @type {HTMLInputElement} */ (document.getElementById("blockedDateInput"));
const addBlockedDateBtn = /** @type {HTMLButtonElement} */ (document.getElementById("addBlockedDateBtn"));
const blockedDatesList = /** @type {HTMLElement} */ (document.getElementById("blockedDatesList"));
const clearFiltersBtn = /** @type {HTMLButtonElement} */ (document.getElementById("clearFiltersBtn"));

// ---- Tab switching ----------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
        btn.classList.add("active");
        const tabId = btn.getAttribute("data-tab");
        document.getElementById("view-" + tabId)?.classList.add("active");
        if (tabId === "options") { updateOptionsUrl(); }
        if (tabId === "filters") { renderFilters(); }
    });
});

// ---- Helpers ----------------------------------------------------------------
function pad(/** @type {number} */ n) { return String(n).padStart(2, "0"); }

function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function endOfMonthStr() {
    const d = new Date();
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return end.getFullYear() + "-" + pad(end.getMonth() + 1) + "-" + pad(end.getDate());
}

// ---- Login prompt -----------------------------------------------------------
/**
 * Show a 401 login prompt inside a container element, replacing its contents.
 * Uses a data-attribute button instead of id so multiple instances work safely.
 * @param {HTMLElement} container
 */
function showLoginPrompt(container) {
    container.innerHTML = `
        <div class="login-prompt">
            <span class="login-icon">🔐</span>
            <div class="login-title">Not logged in</div>
            <div class="login-msg">You need to be logged into ns.gov.sg via Singpass before this extension can fetch data.</div>
            <button class="btn-login" data-action="open-login">Open ns.gov.sg</button>
        </div>`;
    container.querySelector("[data-action='open-login']")?.addEventListener("click", () => {
        chrome.tabs.create({ url: "https://www.ns.gov.sg/web/login" });
    });
}

// ---- Date persistence -------------------------------------------------------
function loadDates() {
    chrome.storage.local.get(["savedDateFrom", "savedDateTo"], (data) => {
        const today = todayStr();

        // Clamp: if the saved start date is in the past, reset it to today
        let savedFrom = typeof data.savedDateFrom === "string" ? data.savedDateFrom : "";
        if (!savedFrom || savedFrom < today) {
            savedFrom = today;
        }

        dateFromInput.value = savedFrom;
        dateToInput.value = typeof data.savedDateTo === "string" ? data.savedDateTo : endOfMonthStr();
        updateOptionsUrl();
    });
}

function saveDates() {
    chrome.storage.local.set({
        savedDateFrom: dateFromInput.value,
        savedDateTo: dateToInput.value,
    });
    updateOptionsUrl();
}

dateFromInput.addEventListener("change", saveDates);
dateToInput.addEventListener("change", saveDates);

// ---- Render locations -------------------------------------------------------
function renderLocations() {
    const query = searchQuery.toLowerCase();

    const preferred = allLocations.filter(l => preferredIds.has(l.fccId) && l.fccName.toLowerCase().includes(query));
    const notPreferred = allLocations.filter(l => !preferredIds.has(l.fccId) && l.fccName.toLowerCase().includes(query));

    prefCount.textContent = String(preferredIds.size);
    notPrefCount.textContent = String(allLocations.length - preferredIds.size);

    preferredList.innerHTML = preferred.length ? "" : `<div class="empty-state"><span class="icon">⭐</span>None yet. Move locations here.</div>`;
    notPreferredList.innerHTML = notPreferred.length ? "" : `<div class="empty-state">No locations found.</div>`;

    for (const loc of preferred) { preferredList.appendChild(makeLocationItem(loc, true)); }
    for (const loc of notPreferred) { notPreferredList.appendChild(makeLocationItem(loc, false)); }
}

/**
 * @param {FccLocation} loc
 * @param {boolean} isPreferred
 */
function makeLocationItem(loc, isPreferred) {
    const item = document.createElement("div");
    item.className = "location-item";

    const nameSpan = document.createElement("span");
    nameSpan.className = "loc-name";
    nameSpan.textContent = loc.fccName;

    const idSpan = document.createElement("span");
    idSpan.className = "loc-id";
    idSpan.textContent = loc.fccId;

    const btn = document.createElement("button");
    btn.className = "move-btn";
    btn.title = isPreferred ? "Remove from preferred" : "Add to preferred";
    btn.textContent = isPreferred ? "x" : "+";

    btn.addEventListener("click", () => {
        if (isPreferred) {
            preferredIds.delete(loc.fccId);
        } else {
            preferredIds.add(loc.fccId);
        }
        savePreferred();
        renderLocations();
        updateOptionsUrl();
    });

    item.appendChild(nameSpan);
    item.appendChild(idSpan);
    item.appendChild(btn);
    return item;
}

// ---- Save preferred ---------------------------------------------------------
function savePreferred() {
    chrome.runtime.sendMessage({ type: "SET_PREFERRED", preferredIds: [...preferredIds] });
}

// ---- Load locations ---------------------------------------------------------
function loadLocations(forceRefresh = false) {
    locStatus.innerHTML = `<span class="spinner"></span> Loading...`;
    refreshBtn.disabled = true;

    const msgType = forceRefresh ? "REFRESH_LOCATIONS" : "GET_LOCATIONS";
    chrome.runtime.sendMessage({ type: msgType }, (response) => {
        refreshBtn.disabled = false;

        if (chrome.runtime.lastError || !response?.success) {
            const err = String(response?.error ?? chrome.runtime.lastError?.message ?? "");
            if (err.includes("401") || err.toLowerCase().includes("singpass") || err.toLowerCase().includes("log in")) {
                locStatus.textContent = "Not logged in";
                // Show login prompt in BOTH columns
                showLoginPrompt(notPreferredList);
                showLoginPrompt(preferredList);
            } else {
                locStatus.textContent = "Error loading locations.";
                notPreferredList.innerHTML = `<div class="empty-state">Failed to load. Try refreshing.</div>`;
            }
            return;
        }

        allLocations = response.locations ?? [];
        if (response.preferredIds) { preferredIds = new Set(response.preferredIds); }

        locStatus.innerHTML = "<strong>" + allLocations.length + "</strong> locations loaded";

        chrome.storage.local.get("locationsFetchedAt", (data) => {
            if (typeof data.locationsFetchedAt === "number") {
                const d = new Date(data.locationsFetchedAt);
                cacheStatus.textContent = "Cached " + d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            }
        });

        renderLocations();
        updateOptionsUrl();
    });
}

// ---- Search -----------------------------------------------------------------
searchBox.addEventListener("input", () => {
    searchQuery = searchBox.value;
    renderLocations();
});

// ---- Refresh button ---------------------------------------------------------
refreshBtn.addEventListener("click", () => loadLocations(true));

// ---- URL builder + preview --------------------------------------------------
/**
 * @param {string[]} ids
 * @param {string} dateFrom
 * @param {string} dateTo
 */
function buildUrl(ids, dateFrom, dateTo) {
    return `https://www.ns.gov.sg/ippt/nsm/api/v1/ippt/booking/sessions-available?trgType=ALL&dateFrom=${dateFrom}&dateTo=${dateTo}&fccId=${encodeURIComponent(ids.join(","))}`;
}

function updateOptionsUrl() {
    const ids = [...preferredIds];
    if (ids.length === 0) {
        urlDisplay.style.display = "none";
        return;
    }
    const dateFrom = dateFromInput.value || todayStr();
    const dateTo = dateToInput.value || endOfMonthStr();
    urlVal.textContent = buildUrl(ids, dateFrom, dateTo);
    urlDisplay.style.display = "block";
}

// ---- Fetch Sessions ---------------------------------------------------------
fetchOptionsBtn.addEventListener("click", async () => {
    optionsError.style.display = "none";

    const ids = [...preferredIds];
    if (ids.length === 0) {
        optionsError.textContent = "No preferred locations selected. Go to Show Locations and mark some as preferred.";
        optionsError.style.display = "block";
        return;
    }

    const dateFrom = dateFromInput.value || todayStr();
    const dateTo = dateToInput.value || endOfMonthStr();
    updateOptionsUrl();
    resultsBox.innerHTML = `<div class="empty-state"><span class="spinner"></span> Fetching sessions...</div>`;
    fetchOptionsBtn.disabled = true;

    try {
        /** @type {OptionsResponse} */
        const response = await new Promise(resolve => {
            chrome.runtime.sendMessage({ type: "GET_OPTIONS", dateFrom, dateTo }, resolve);
        });
        if (!response?.success) {
            const error = String(response?.error ?? "Failed to fetch sessions.");
            if (error.toLowerCase().includes("singpass") || error.toLowerCase().includes("log in")) {
                showLoginPrompt(resultsBox);
            } else {
                throw new Error(error);
            }
            return;
        }

        renderSessionResults(
            resultsBox,
            response.slots ?? [],
            response.bookings ?? [],
            preferredIds,
            blockedDays,
            blockedDates
        );

    } catch (err) {
        optionsError.textContent = String(err);
        optionsError.style.display = "block";
        resultsBox.innerHTML = `<div class="empty-state"><span class="icon">⚠️</span>Failed to fetch sessions.</div>`;
    } finally {
        fetchOptionsBtn.disabled = false;
    }
});

// ---- FILTERS TAB -----------------------------------------------------------

/**
 * Persist the current blockedDays + blockedDates to chrome.storage.
 */
function saveFilters() {
    chrome.storage.local.set({
        blockedDays: [...blockedDays],
        blockedDates: [...blockedDates],
    });
}

/**
 * Load filters from storage and sync UI.
 */
function loadFilters() {
    chrome.storage.local.get(["blockedDays", "blockedDates"], (data) => {
        const savedDays = Array.isArray(data.blockedDays) ? data.blockedDays : [];
        const savedDates = Array.isArray(data.blockedDates) ? data.blockedDates : [];
        blockedDays = new Set(savedDays.map(Number));
        blockedDates = new Set(savedDates.filter(value => typeof value === "string"));
        renderFilters();
    });
}

/**
 * Sync the filter UI to the current in-memory state.
 */
function renderFilters() {
    // Day-of-week checkboxes
    dayCheckboxes.forEach(cb => {
        cb.checked = blockedDays.has(Number(cb.value));
    });

    // Blocked dates list
    blockedDatesList.innerHTML = "";
    if (blockedDates.size === 0) {
        blockedDatesList.innerHTML = `<div class="empty-state" style="padding:8px 0;font-size:11px;">No specific dates blocked.</div>`;
        return;
    }
    [...blockedDates].sort().forEach(dateStr => {
        const row = document.createElement("div");
        row.className = "filter-date-row";

        const label = document.createElement("span");
        label.className = "filter-date-label";
        // Show the day name alongside for clarity
        const d = new Date(dateStr + "T00:00:00"); // force local parse
        const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
        label.textContent = dayName + "  " + dateStr;

        const removeBtn = document.createElement("button");
        removeBtn.className = "btn-small";
        removeBtn.textContent = "Remove";
        removeBtn.addEventListener("click", () => {
            blockedDates.delete(dateStr);
            saveFilters();
            renderFilters();
        });

        row.appendChild(label);
        row.appendChild(removeBtn);
        blockedDatesList.appendChild(row);
    });
}

// Day checkbox toggles
dayCheckboxes.forEach(cb => {
    cb.addEventListener("change", () => {
        const day = Number(cb.value);
        if (cb.checked) {
            blockedDays.add(day);
        } else {
            blockedDays.delete(day);
        }
        saveFilters();
    });
});

// Add a specific blocked date
addBlockedDateBtn.addEventListener("click", () => {
    const val = blockedDateInput.value;
    if (!val) { return; }
    blockedDates.add(val);
    blockedDateInput.value = "";
    saveFilters();
    renderFilters();
});

// Also allow pressing Enter in the date input
blockedDateInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { addBlockedDateBtn.click(); }
});

// Clear all filters
clearFiltersBtn.addEventListener("click", () => {
    blockedDays.clear();
    blockedDates.clear();
    saveFilters();
    renderFilters();
});

// ---- Boot -------------------------------------------------------------------
loadDates();
loadLocations();
loadFilters();
