/**
 * @typedef {{ dateTime: Date, display: string, vacancyDisplay: string, trgType: string }} BookingSlot
 * @typedef {{ fccId: string, fccName: string, dateTimeStart: string, vacancyDisplay: string, trgType: string }} SessionResponse
 * @typedef {{ fccName: string, dateTimeStart: string, trgType: string }} BookingResponse
 */

const TYPE_ORDER = ["NS FIT", "IPPT"];

function pad(/** @type {number} */ number) {
    return String(number).padStart(2, "0");
}

function dateFormatting(/** @type {Date} */ date) {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days[date.getDay()] + " " + pad(date.getDate()) + "/" + pad(date.getMonth() + 1) + "/" + date.getFullYear() + " " + pad(date.getHours()) + pad(date.getMinutes()) + "H";
}

function toLocalDateStr(/** @type {Date} */ date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

function typeStyle(/** @type {string} */ trgType) {
    const type = trgType.toUpperCase();
    if (type === "NS FIT" || type === "NSFIT") return { cssClass: "type-ns-fit", label: "NS FIT" };
    if (type === "IPPT") return { cssClass: "type-ippt", label: "IPPT" };
    return { cssClass: "type-other", label: trgType };
}

function isFilteredOut(/** @type {Date} */ dateTime, /** @type {Set<number>} */ blockedDays, /** @type {Set<string>} */ blockedDates) {
    return blockedDays.has(dateTime.getDay()) || blockedDates.has(toLocalDateStr(dateTime));
}

function showEmptyState(/** @type {HTMLElement} */ resultsBox, /** @type {string} */ message) {
    resultsBox.innerHTML = `<div class="empty-state"><span class="icon">🔍</span>${message}</div>`;
}

function renderBookings(/** @type {HTMLElement} */ resultsBox, /** @type {BookingResponse[]} */ bookings) {
    if (bookings.length === 0) return;

    const section = document.createElement("div");
    section.className = "booked-section";
    section.innerHTML = `<div class="booked-title">📌 Current Bookings</div>`;

    for (const { fccName, dateTimeStart, trgType } of bookings) {
        const item = document.createElement("div");
        item.className = "booked-item";
        item.textContent = dateFormatting(new Date(dateTimeStart)) + " - " + fccName + " (" + trgType + ")";
        section.appendChild(item);
    }

    resultsBox.appendChild(section);
}

function groupSlots(/** @type {SessionResponse[]} */ slots, /** @type {Set<string>} */ preferredIds, /** @type {Set<number>} */ blockedDays, /** @type {Set<string>} */ blockedDates) {
    /** @type {Object.<string, { [trgType: string]: BookingSlot[] }>} */
    const grouping = {};

    for (const { fccId, fccName, dateTimeStart, vacancyDisplay, trgType } of slots) {
        if (!preferredIds.has(fccId)) continue;

        const dateTime = new Date(dateTimeStart);
        if (isFilteredOut(dateTime, blockedDays, blockedDates)) continue;

        grouping[fccName] ??= {};
        grouping[fccName][trgType] ??= [];
        grouping[fccName][trgType].push({
            dateTime,
            display: dateFormatting(dateTime),
            vacancyDisplay,
            trgType,
        });
    }

    for (const venueSlots of Object.values(grouping)) {
        for (const slotsByType of Object.values(venueSlots)) {
            slotsByType.sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());
        }
    }

    return grouping;
}

function renderGroups(/** @type {HTMLElement} */ resultsBox, /** @type {Object.<string, { [trgType: string]: BookingSlot[] }>} */ grouping) {
    for (const venue of Object.keys(grouping).sort()) {
        const venueSlots = grouping[venue];
        const types = Object.keys(venueSlots).sort((a, b) => {
            const firstIndex = TYPE_ORDER.indexOf(a);
            const secondIndex = TYPE_ORDER.indexOf(b);
            return (firstIndex === -1 ? 99 : firstIndex) - (secondIndex === -1 ? 99 : secondIndex);
        });

        const group = document.createElement("div");
        group.className = "result-group";

        const title = document.createElement("div");
        title.className = "result-venue";
        title.textContent = venue;
        group.appendChild(title);

        for (const trgType of types) {
            const slots = venueSlots[trgType];
            if (slots.length === 0) continue;

            const { cssClass, label } = typeStyle(trgType);
            const typeHeader = document.createElement("div");
            typeHeader.className = "result-type-header " + cssClass;
            typeHeader.textContent = label;
            group.appendChild(typeHeader);

            for (const { display, vacancyDisplay } of slots) {
                const slot = document.createElement("div");
                slot.className = "result-slot";
                slot.textContent = display + " - ";

                const vacancies = document.createElement("span");
                vacancies.className = "slot-vacancies";
                vacancies.textContent = vacancyDisplay + " slots";
                slot.appendChild(vacancies);
                group.appendChild(slot);
            }
        }

        resultsBox.appendChild(group);
    }
}

/**
 * Filter, group, sort, and render the sessions response.
 * @param {HTMLElement} resultsBox
 * @param {SessionResponse[]} slots
 * @param {BookingResponse[]} bookings
 * @param {Set<string>} preferredIds
 * @param {Set<number>} blockedDays
 * @param {Set<string>} blockedDates
 */
export function renderSessionResults(resultsBox, slots, bookings, preferredIds, blockedDays, blockedDates) {
    const grouping = groupSlots(slots, preferredIds, blockedDays, blockedDates);
    if (Object.keys(grouping).length === 0) {
        showEmptyState(resultsBox, "No available sessions found for the selected locations and date range.");
        return;
    }

    resultsBox.innerHTML = "";
    renderBookings(resultsBox, bookings);
    renderGroups(resultsBox, grouping);
}
