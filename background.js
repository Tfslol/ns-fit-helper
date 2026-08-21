// @ts-check
/// <reference types="chrome"/>

/** @typedef {{ fccId: string, fccName: string }} WorkerFccLocation */
/** @typedef {{ fccId: string, fccName: string, dateTimeStart: string, vacancyDisplay: string, trgType: string }} SessionSlot */
/** @typedef {{ fccName: string, dateTimeStart: string, trgType: string }} WorkerBookingResponse */

/**
 * @returns {Promise<void>}
 */
function clearStorage() { return chrome.storage.local.clear(); }

/**
 * @param {Record<string, unknown>} data
 * @returns {Promise<void>}
 */
function setStorage(data) { return chrome.storage.local.set(data); }

/**
 * @param {string} key
 * @returns {Promise<any>}
 */
async function getStorage(key) { return (await chrome.storage.local.get(key))[key]; }

/**
 * Fetch all FCC locations from the API and cache them.
 * Returns array of { fccId, fccName } objects.
 * @returns {Promise<WorkerFccLocation[]>}
 */
async function fetchAndCacheLocations() {
    let response;
    try {
        response = await fetch("https://www.ns.gov.sg/ippt/nsm/api/v1/ippt/booking/fcc-locations?trgType=NS+FIT");
        if (response.status === 401) { throw new Error("Log into Singpass"); }
        if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
    } catch (err) {
        console.error("fetchAndCacheLocations error:", err);
        throw err;
    }
    /** @type {{ data: { location: { fccId: string|number, fccName: string }[] } }} */
    const dataObj = await response.json();

    /** @type {WorkerFccLocation[]} */
    const locations = dataObj.data.location.map(({ fccId, fccName }) => ({
        fccId: String(fccId),
        fccName: String(fccName)
    }));

    await setStorage({
        allLocations: locations,
        locationsFetchedAt: Date.now()
    });

    console.log(`Cached ${locations.length} locations.`);
    return locations;
}

/**
 * Get locations from cache if fresh (within maxAgeMs), otherwise re-fetch.
 * @param {number} [maxAgeMs] Default: 24 hours
 * @returns {Promise<WorkerFccLocation[]>}
 */
async function getLocations(maxAgeMs = 24 * 60 * 60 * 1000) {
    const cachedLocations = await getStorage("allLocations");
    const fetchedAt = await getStorage("locationsFetchedAt");

    if (cachedLocations && fetchedAt && (Date.now() - fetchedAt) < maxAgeMs) {
        console.log("Using cached locations.");
        return cachedLocations;
    }

    console.log("Fetching fresh locations...");
    return fetchAndCacheLocations();
}

/**
 * @returns {Promise<string[]>} Array of preferred fccIds
 */
async function getPreferredIds() {
    return (await getStorage("preferredIds")) ?? [];
}

/**
 * @param {string[]} preferredIds
 * @returns {Promise<void>}
 */
async function setPreferredIds(preferredIds) {
    await setStorage({ preferredIds });
}

/**
 * Fetch available sessions for given fccIds.
 * @param {string} dateFrom
 * @param {string} dateTo
 * @param {string[]} fccIds
 * @returns {Promise<SessionSlot[]>}
 */
async function fetcher(dateFrom, dateTo, ...fccIds) {
    if (fccIds.length === 0) {
        return [];
    }

    const fccIdParam = encodeURIComponent(fccIds.join(","));
    const url = `https://www.ns.gov.sg/ippt/nsm/api/v1/ippt/booking/sessions-available?trgType=ALL&dateFrom=${dateFrom}&dateTo=${dateTo}&fccId=${fccIdParam}`;

    let response;
    try {
        response = await fetch(url);
        if (response.status === 401) { throw new Error("Log into Singpass"); }
        if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
    } catch (err) {
        throw err;
    }

    /** @type {{ data: { bookingSlot: SessionSlot[] } }} */
    const dataObj = await response.json();
    return dataObj.data.bookingSlot.filter(slot => fccIds.includes(slot.fccId));
}

/** @returns {Promise<WorkerBookingResponse[]>} */
async function getBooked() {
    let response;
    try {
        response = await fetch("https://www.ns.gov.sg/ippt/nsm/api/v1/ippt/booking/current-window");
        if (response.status === 401) { throw new Error("Log into Singpass"); }
        if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
    } catch (err) {
        throw err;
    }

    /** @type {{ data: { booking: WorkerBookingResponse[] } }} */
    const dataObj = await response.json();
    return dataObj.data.booking
        .filter(booking => new Date(booking.dateTimeStart) > new Date())
        .sort((a, b) => a.dateTimeStart.localeCompare(b.dateTimeStart));
}

// Expose functions for popup to call via chrome.runtime.sendMessage
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        try {
            if (message.type === "GET_LOCATIONS") {
                const locations = await getLocations(message.maxAgeMs);
                const preferredIds = await getPreferredIds();
                sendResponse({ success: true, locations, preferredIds });

            } else if (message.type === "REFRESH_LOCATIONS") {
                const locations = await fetchAndCacheLocations();
                sendResponse({ success: true, locations });

            } else if (message.type === "SET_PREFERRED") {
                await setPreferredIds(message.preferredIds);
                sendResponse({ success: true });

            } else if (message.type === "GET_OPTIONS") {
                const preferredIds = await getPreferredIds();
                if (preferredIds.length === 0) {
                    sendResponse({ success: false, error: "No preferred locations set." });
                    return;
                }
                const dateFrom = String(message.dateFrom ?? "");
                const dateTo = String(message.dateTo ?? "");
                if (!dateFrom || !dateTo) {
                    sendResponse({ success: false, error: "A valid date range is required." });
                    return;
                }
                const slots = await fetcher(dateFrom, dateTo, ...preferredIds);
                /** @type {WorkerBookingResponse[]} */
                let bookings = [];
                try {
                    bookings = await getBooked();
                } catch (err) {
                    console.warn("Unable to load current bookings:", err);
                }
                sendResponse({ success: true, preferredIds, slots, bookings });

            } else {
                sendResponse({ success: false, error: "Unknown message type." });
            }
        } catch (err) {
            sendResponse({ success: false, error: String(err) });
        }
    })();
    return true; // Keep message channel open for async response
});