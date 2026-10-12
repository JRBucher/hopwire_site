// Owner dashboard logic — talks to the live HopWire_API (see assets/app.js).
// `session` is defined by the inline script in dashboard.html, which redirects
// to login.html and leaves `session` null if there's no valid one.
if (session) {
    const breweryId = session.breweryId;
    document.getElementById("sidebar-brewery-name").textContent = session.breweryName || "Your brewery";

    // ── NAV / VIEW SWITCHING ─────────────────────────────────────────────────
    const navItems = document.querySelectorAll(".dash-nav-item[data-view]");
    const views = document.querySelectorAll(".dash-view");
    const loaded = {};

    function showView(name) {
        navItems.forEach(b => b.classList.toggle("active", b.dataset.view === name));
        views.forEach(v => v.classList.toggle("active", v.id === `view-${name}`));
        if (!loaded[name]) {
            loaded[name] = true;
            if (name === "overview") loadOverview();
            if (name === "events") loadEvents();
            if (name === "specials") loadSpecials();
            if (name === "releases") loadReleases();
            if (name === "analytics") loadAnalytics();
            if (name === "profile") loadProfile();
        }
    }

    navItems.forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.view)));
    document.getElementById("logout-btn").addEventListener("click", () => {
        HW.clearSession();
        window.location.href = "login.html";
    });

    function escapeHtml(str) {
        return (str ?? "").toString().replace(/[&<>"']/g, c => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
    }

    function formatDate(iso) {
        if (!iso) return "";
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    }

    function formatDateTimeRange(startIso, endIso) {
        const start = new Date(startIso);
        const startStr = start.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        if (!endIso) return startStr;
        const end = new Date(endIso);
        const endStr = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        return `${startStr} – ${endStr}`;
    }

    function toLocalDateTimeInputValue(iso) {
        // Server dates come back naive (no offset) — treat as literal wall-clock
        // time, no timezone conversion, so a stored "19:00" shows as "19:00".
        if (!iso) return "";
        return iso.slice(0, 16);
    }

    function toDateInputValue(iso) {
        if (!iso) return "";
        return iso.slice(0, 10);
    }

    function dayChipHtml(iso, variant) {
        const d = new Date(iso);
        const mon = d.toLocaleDateString(undefined, { month: "short" });
        return `<div class="day-chip icon-${variant}"><span class="mon">${mon}</span><span class="day">${d.getDate()}</span></div>`;
    }

    function setTrendChip(id, delta, suffix) {
        const el = document.getElementById(id);
        if (!el) return;
        const sign = delta > 0 ? "+" : "";
        el.textContent = `${sign}${delta} ${suffix}`;
        el.className = "trend-chip " + (delta > 0 ? "up" : delta < 0 ? "down" : "flat");
    }

    // ── OVERVIEW ─────────────────────────────────────────────────────────────
    function timeOfDayGreeting() {
        const hour = new Date().getHours();
        if (hour < 5) return "Burning the midnight oil";
        if (hour < 12) return "Good morning";
        if (hour < 17) return "Good afternoon";
        return "Good evening";
    }

    async function loadOverview() {
        try {
            const summary = await HW.apiJson(`/api/breweries/${breweryId}/dashboard-summary`);
            const breweryName = summary.breweryName || session.breweryName || "";
            document.getElementById("overview-heading").textContent = breweryName
                ? `${timeOfDayGreeting()}, ${breweryName}`
                : timeOfDayGreeting();
            document.getElementById("overview-subhead").textContent =
                new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) +
                " — here's what's pouring.";
            document.getElementById("sidebar-brewery-name").textContent = breweryName;
            document.getElementById("stat-checkins").textContent = summary.weeklyCheckinCount ?? "0";
            document.getElementById("stat-followers").textContent = summary.followerCount ?? "0";
            document.getElementById("stat-upcoming").textContent = summary.upcomingEventCount ?? "0";
        } catch (err) {
            console.error(err);
        }

        try {
            // window=all (not just "upcoming") so the next-7-days trend below
            // can compare against the 7 days before today, too.
            const events = await HW.apiJson(`/api/breweries/${breweryId}/events?userId=0&window=all`);
            const now = new Date();
            const upcoming = events
                .filter(ev => new Date(ev.endAt || ev.startAt) >= now)
                .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

            const el = document.getElementById("overview-upcoming");
            el.innerHTML = upcoming.length
                ? upcoming.slice(0, 5).map(ev => `
                    <div class="item-row">
                        ${dayChipHtml(ev.startAt, "blue")}
                        <div class="item-info">
                            <div class="item-title">${escapeHtml(ev.title)}</div>
                            <div class="item-meta">${formatDateTimeRange(ev.startAt, ev.endAt)}</div>
                        </div>
                    </div>
                `).join("")
                : `<div class="empty-state">No upcoming events yet — add one from the Events tab.</div>`;

            const in7 = new Date(now.getTime() + 7 * 86400000);
            const prev7 = new Date(now.getTime() - 7 * 86400000);
            const nextWeekCount = events.filter(ev => { const s = new Date(ev.startAt); return s >= now && s < in7; }).length;
            const lastWeekCount = events.filter(ev => { const s = new Date(ev.startAt); return s >= prev7 && s < now; }).length;
            setTrendChip("stat-upcoming-trend", nextWeekCount - lastWeekCount, "vs last 7 days");
        } catch (err) {
            console.error(err);
        }

        try {
            const [checkinsNow, checkinsPrev] = await Promise.all([
                HW.apiJson(`/api/breweries/${breweryId}/analytics/checkins?weekOffset=0`),
                HW.apiJson(`/api/breweries/${breweryId}/analytics/checkins?weekOffset=1`)
            ]);
            const thisWeek = (checkinsNow.perWeekdaySelectedWeek || []).reduce((a, b) => a + b, 0);
            const lastWeek = (checkinsPrev.perWeekdaySelectedWeek || []).reduce((a, b) => a + b, 0);
            setTrendChip("stat-checkins-trend", thisWeek - lastWeek, "vs last week");
        } catch (err) {
            console.error(err);
        }

        try {
            const followers = await HW.apiJson(`/api/breweries/${breweryId}/analytics/followers`);
            setTrendChip("stat-followers-trend", followers.thisWeekNet, "this week");
        } catch (err) {
            console.error(err);
        }
    }

    // ── EVENTS ───────────────────────────────────────────────────────────────
    const eventForm = document.getElementById("event-form");
    const eventAlert = document.getElementById("events-alert");
    const eventCancelBtn = document.getElementById("event-cancel-btn");

    const eventRepeatField = document.getElementById("event-repeat-field");

    function resetEventForm() {
        eventForm.reset();
        document.getElementById("event-id").value = "";
        document.getElementById("events-form-title").textContent = "New event";
        document.getElementById("event-submit-btn").textContent = "Post Event";
        eventCancelBtn.style.display = "none";
        eventRepeatField.style.display = "";
    }

    eventCancelBtn.addEventListener("click", resetEventForm);

    // ── EVENTS: month/week calendar strip ───────────────────────────────────
    // Purely a glance widget (which days this week/month have something on) —
    // navigating it doesn't filter the Upcoming/Past lists below, it just
    // moves which week is shown in the strip. Events are already loaded in
    // full (window=all) by loadEvents, so no extra API calls are needed here.
    let calendarAnchor = new Date();
    let allEventsCache = [];

    function startOfWeek(d) {
        const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        copy.setDate(copy.getDate() - copy.getDay());
        return copy;
    }

    function renderCalendarStrip() {
        const weekStart = startOfWeek(calendarAnchor);
        const days = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(weekStart);
            d.setDate(d.getDate() + i);
            return d;
        });
        document.getElementById("cal-month-label").textContent =
            days[3].toLocaleDateString(undefined, { month: "long", year: "numeric" });

        const todayKey = new Date().toDateString();
        const eventDateKeys = new Set(allEventsCache.map(ev => new Date(ev.startAt).toDateString()));

        document.getElementById("cal-week-strip").innerHTML = days.map(d => {
            const key = d.toDateString();
            const hasEvent = eventDateKeys.has(key);
            return `
                <div class="week-cell${hasEvent ? " has-event" : ""}${key === todayKey ? " is-today" : ""}">
                    <div class="dow">${d.toLocaleDateString(undefined, { weekday: "short" })}</div>
                    <div class="dnum">${d.getDate()}</div>
                    ${hasEvent ? `<div class="dot"></div>` : ""}
                </div>
            `;
        }).join("");
    }

    document.getElementById("cal-week-prev").addEventListener("click", () => {
        calendarAnchor = new Date(calendarAnchor.getTime() - 7 * 86400000);
        renderCalendarStrip();
    });
    document.getElementById("cal-week-next").addEventListener("click", () => {
        calendarAnchor = new Date(calendarAnchor.getTime() + 7 * 86400000);
        renderCalendarStrip();
    });
    document.getElementById("cal-month-prev").addEventListener("click", () => {
        calendarAnchor = new Date(calendarAnchor.getFullYear(), calendarAnchor.getMonth() - 1, 1);
        renderCalendarStrip();
    });
    document.getElementById("cal-month-next").addEventListener("click", () => {
        calendarAnchor = new Date(calendarAnchor.getFullYear(), calendarAnchor.getMonth() + 1, 1);
        renderCalendarStrip();
    });

    function renderEventRow(ev, isPast) {
        const actions = isPast
            ? `<button class="btn-pill outline small" data-action="photos">View Photos</button>
               <button class="btn-pill danger" data-action="delete">Delete</button>`
            : `<button class="btn-pill outline small" data-action="edit">Edit</button>
               <button class="btn-pill danger" data-action="delete">Delete</button>`;
        return `
            <div class="item-row ${isPast ? "is-past" : ""}" data-id="${ev.id}" style="align-items:flex-start;">
                ${dayChipHtml(ev.startAt, isPast ? "muted" : "blue")}
                <div class="item-info">
                    <div class="item-title">${escapeHtml(ev.title)}</div>
                    <div class="item-meta">${formatDateTimeRange(ev.startAt, ev.endAt)}</div>
                    ${isPast ? `<div class="photo-panel" style="display:none;"></div>` : ""}
                </div>
                <div class="item-actions">${actions}</div>
            </div>
        `;
    }

    // Groups events that share a title — the "Repeats" option on the form
    // posts one real event row per occurrence (no shared series id comes
    // back from the API), so a weekly series can be 50+ rows. Collapse
    // same-title runs into one expandable group instead of listing them flat.
    function groupEventsByTitle(list) {
        const groups = [];
        const index = new Map();
        for (const ev of list) {
            const key = (ev.title || "").trim().toLowerCase();
            if (index.has(key)) {
                groups[index.get(key)].items.push(ev);
            } else {
                index.set(key, groups.length);
                groups.push({ title: ev.title, items: [ev] });
            }
        }
        return groups;
    }

    function renderEventGroup(group, isPast) {
        if (group.items.length === 1) {
            return renderEventRow(group.items[0], isPast);
        }
        const first = group.items[0];
        const count = group.items.length;
        const nextLabel = isPast
            ? `most recent ${formatDate(first.startAt)}`
            : `next ${formatDateTimeRange(first.startAt, first.endAt)}`;
        return `
            <div class="series-group">
                <button type="button" class="series-header" aria-expanded="false">
                    <span class="series-icon">↻</span>
                    <span class="series-info">
                        <span class="series-title">${escapeHtml(group.title)}</span>
                        <span class="series-meta">${count} ${isPast ? "past" : "upcoming"} · ${nextLabel}</span>
                    </span>
                    <span class="series-chevron">⌄</span>
                </button>
                <div class="series-body" hidden>
                    ${group.items.map(ev => renderEventRow(ev, isPast)).join("")}
                </div>
            </div>
        `;
    }

    function wireSeriesToggles(container) {
        container.querySelectorAll(".series-header").forEach(btn => {
            btn.addEventListener("click", () => {
                const expanded = btn.getAttribute("aria-expanded") === "true";
                btn.setAttribute("aria-expanded", String(!expanded));
                btn.nextElementSibling.hidden = expanded;
            });
        });
    }

    function wireEventRow(row, events) {
        const id = row.dataset.id;
        const ev = events.find(e => String(e.id) === id);

        const editBtn = row.querySelector('[data-action="edit"]');
        if (editBtn) {
            editBtn.addEventListener("click", () => {
                document.getElementById("event-id").value = ev.id;
                document.getElementById("event-title").value = ev.title || "";
                document.getElementById("event-desc").value = ev.description || "";
                document.getElementById("event-start").value = toLocalDateTimeInputValue(ev.startAt);
                document.getElementById("event-end").value = toLocalDateTimeInputValue(ev.endAt);
                document.getElementById("events-form-title").textContent = "Edit event";
                document.getElementById("event-submit-btn").textContent = "Save changes";
                eventCancelBtn.style.display = "inline-flex";
                eventRepeatField.style.display = "none"; // repeat only applies when creating a new series
                eventForm.scrollIntoView({ behavior: "smooth" });
            });
        }

        const photosBtn = row.querySelector('[data-action="photos"]');
        if (photosBtn) {
            const panel = row.querySelector(".photo-panel");
            let loaded = false;
            photosBtn.addEventListener("click", async () => {
                const showing = panel.style.display !== "none";
                if (showing) {
                    panel.style.display = "none";
                    photosBtn.textContent = "View Photos";
                    return;
                }
                panel.style.display = "block";
                photosBtn.textContent = "Hide Photos";
                if (loaded) return;
                loaded = true;
                panel.innerHTML = `<div class="empty-state" style="padding:12px 0;">Loading…</div>`;
                try {
                    const photos = await HW.apiJson(`/api/events/${ev.id}/shared-photos`);
                    if (!photos.length) {
                        panel.innerHTML = `<div class="empty-state" style="padding:12px 0;">No photos shared for this event.</div>`;
                        return;
                    }
                    panel.innerHTML = `<div class="photo-grid">${photos.map((p, i) => `
                        <a class="photo-item" href="data:image/jpeg;base64,${p.photoBytes}" download="hopwire-event-${ev.id}-photo-${i + 1}.jpg" title="Save photo">
                            <img src="data:image/jpeg;base64,${p.photoBytes}" alt="Shared photo" loading="lazy">
                            <span class="photo-save-label">Save</span>
                        </a>
                    `).join("")}</div>`;
                } catch (err) {
                    panel.innerHTML = `<div class="empty-state" style="padding:12px 0;">Couldn't load photos.</div>`;
                }
            });
        }

        row.querySelector('[data-action="delete"]').addEventListener("click", async () => {
            if (!confirm(`Delete "${ev.title}"?`)) return;
            try {
                await HW.apiJson(`/api/events/${ev.id}?breweryId=${breweryId}`, { method: "DELETE" });
                loadEvents();
            } catch (err) {
                HW.showAlert(eventAlert, err.message);
            }
        });
    }

    async function loadEvents() {
        try {
            const events = await HW.apiJson(`/api/breweries/${breweryId}/events?userId=0&window=all`);
            allEventsCache = events;
            renderCalendarStrip();
            const now = new Date();

            const upcoming = events
                .filter(ev => new Date(ev.endAt || ev.startAt) >= now)
                .sort((a, b) => new Date(a.startAt) - new Date(b.startAt)); // soonest first

            const past = events
                .filter(ev => new Date(ev.endAt || ev.startAt) < now)
                .sort((a, b) => new Date(b.startAt) - new Date(a.startAt)); // most recent first

            document.getElementById("events-upcoming-count").textContent = upcoming.length;
            document.getElementById("events-past-count").textContent = past.length;

            const upcomingEl = document.getElementById("events-upcoming-list");
            upcomingEl.innerHTML = upcoming.length
                ? groupEventsByTitle(upcoming).map(g => renderEventGroup(g, false)).join("")
                : `<div class="empty-state">Nothing on the calendar yet — post your first event above.</div>`;
            upcomingEl.querySelectorAll(".item-row").forEach(row => wireEventRow(row, events));
            wireSeriesToggles(upcomingEl);

            const pastEl = document.getElementById("events-past-list");
            pastEl.innerHTML = past.length
                ? groupEventsByTitle(past).map(g => renderEventGroup(g, true)).join("")
                : `<div class="empty-state">No past events yet.</div>`;
            pastEl.querySelectorAll(".item-row").forEach(row => wireEventRow(row, events));
            wireSeriesToggles(pastEl);
        } catch (err) {
            HW.showAlert(eventAlert, err.message);
        }
    }

    eventForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        HW.hideAlert(eventAlert);
        const editingId = document.getElementById("event-id").value;
        const imageFile = document.getElementById("event-image").files[0];

        try {
            const payload = {
                title: document.getElementById("event-title").value.trim(),
                description: document.getElementById("event-desc").value.trim() || null,
                startAt: `${document.getElementById("event-start").value}:00`,
                endAt: `${document.getElementById("event-end").value}:00`,
                imageBytes: imageFile ? await HW.fileToBase64(imageFile) : null
            };

            if (editingId) {
                await HW.apiJson(`/api/events/${editingId}`, {
                    method: "PUT",
                    body: JSON.stringify(Object.assign({ breweryId }, payload))
                });
            } else {
                payload.repeat = document.getElementById("event-repeat").value;
                await HW.apiJson(`/api/breweries/${breweryId}/events`, {
                    method: "POST",
                    body: JSON.stringify(payload)
                });
            }

            resetEventForm();
            loadEvents();
        } catch (err) {
            HW.showAlert(eventAlert, err.message);
        }
    });

    // ── SPECIALS ─────────────────────────────────────────────────────────────
    const specialForm = document.getElementById("special-form");
    const specialsAlert = document.getElementById("specials-alert");

    function renderSpecialRow(s) {
        const isToday = new Date(s.date).getTime() === new Date(new Date().toDateString()).getTime();
        return `
            <div class="ticket-card${isToday ? " is-today" : ""}" data-id="${s.id}">
                ${isToday ? `<div class="ribbon">Today</div>` : ""}
                <div class="offer">${escapeHtml(s.message)}</div>
                <div class="date">${formatDate(s.date)}</div>
                <div class="item-actions">
                    <button class="btn-pill danger" data-action="delete">Delete</button>
                </div>
            </div>
        `;
    }

    function wireSpecialRow(row) {
        const id = row.dataset.id;
        row.querySelector('[data-action="delete"]').addEventListener("click", async () => {
            if (!confirm("Delete this special?")) return;
            try {
                await HW.apiJson(`/api/specials/${id}`, { method: "DELETE" });
                loadSpecials();
            } catch (err) {
                HW.showAlert(specialsAlert, err.message);
            }
        });
    }

    // Same "repeats" situation as events — one row per occurrence comes back
    // from the API with no shared series id, so group same-message specials
    // into one expandable row instead of listing every date flat.
    function groupSpecialsByMessage(list) {
        const groups = [];
        const index = new Map();
        for (const s of list) {
            const key = (s.message || "").trim().toLowerCase();
            if (index.has(key)) {
                groups[index.get(key)].items.push(s);
            } else {
                index.set(key, groups.length);
                groups.push({ message: s.message, items: [s] });
            }
        }
        return groups;
    }

    function renderSpecialGroup(group) {
        if (group.items.length === 1) {
            return renderSpecialRow(group.items[0]);
        }
        const first = group.items[0];
        return `
            <div class="series-group">
                <button type="button" class="series-header" aria-expanded="false">
                    <span class="series-icon">↻</span>
                    <span class="series-info">
                        <span class="series-title">${escapeHtml(group.message)}</span>
                        <span class="series-meta">${group.items.length} upcoming · next ${formatDate(first.date)}</span>
                    </span>
                    <span class="series-chevron">⌄</span>
                </button>
                <div class="series-body" hidden>
                    ${group.items.map(s => renderSpecialRow(s)).join("")}
                </div>
            </div>
        `;
    }

    async function loadSpecials() {
        try {
            const specials = await HW.apiJson(`/api/breweries/${breweryId}/specials`);
            const el = document.getElementById("specials-list");
            const upcoming = specials
                .filter(s => new Date(s.date) >= new Date(new Date().toDateString()))
                .sort((a, b) => new Date(a.date) - new Date(b.date));
            if (!upcoming.length) {
                el.innerHTML = `<div class="empty-state">No specials on deck — line one up above.</div>`;
                return;
            }
            el.innerHTML = groupSpecialsByMessage(upcoming).slice(0, 40).map(g => renderSpecialGroup(g)).join("");
            el.querySelectorAll(".item-row").forEach(row => wireSpecialRow(row));
            wireSeriesToggles(el);
        } catch (err) {
            HW.showAlert(specialsAlert, err.message);
        }
    }

    specialForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        HW.hideAlert(specialsAlert);
        const imageFile = document.getElementById("special-image").files[0];

        try {
            const payload = {
                message: document.getElementById("special-message").value.trim(),
                date: document.getElementById("special-date").value,
                repeat: document.getElementById("special-repeat").value,
                imageBytes: imageFile ? await HW.fileToBase64(imageFile) : null
            };
            await HW.apiJson(`/api/breweries/${breweryId}/specials`, {
                method: "POST",
                body: JSON.stringify(payload)
            });
            specialForm.reset();
            loadSpecials();
        } catch (err) {
            HW.showAlert(specialsAlert, err.message);
        }
    });

    // ── BEER RELEASES ────────────────────────────────────────────────────────
    const releaseForm = document.getElementById("release-form");
    const releasesAlert = document.getElementById("releases-alert");
    const releaseCancelBtn = document.getElementById("release-cancel-btn");

    function resetReleaseForm() {
        releaseForm.reset();
        document.getElementById("release-id").value = "";
        document.getElementById("releases-form-title").textContent = "New release";
        document.getElementById("release-submit-btn").textContent = "Post Release";
        releaseCancelBtn.style.display = "none";
    }

    releaseCancelBtn.addEventListener("click", resetReleaseForm);

    // Loose keyword mapping from beer style text to a tap-list swatch color —
    // decorative only, falls back to the brand accent for anything unmatched.
    function beerSwatchColor(styleText) {
        const s = (styleText || "").toLowerCase();
        if (/stout|porter/.test(s)) return "#4a2c17";
        if (/lager|pilsner|helles|bock/.test(s)) return "#f3d27a";
        if (/red|amber|irish/.test(s)) return "#c9542e";
        if (/sour|fruit|gose|berliner/.test(s)) return "#d174b0";
        if (/ipa|pale|wheat|saison|wit|hazy|neipa/.test(s)) return "#e8a13c";
        return "var(--accent)";
    }

    async function loadReleases() {
        try {
            const releases = await HW.apiJson(`/api/breweries/${breweryId}/beer-releases`);
            const el = document.getElementById("releases-list");
            if (!releases.length) {
                el.innerHTML = `<div class="empty-state">Nothing brewing yet — post your first release above.</div>`;
                return;
            }
            el.innerHTML = releases.map(r => {
                const isNew = Math.abs(new Date(r.releaseDate) - new Date()) <= 14 * 86400000;
                return `
                <div class="beer-card" data-id="${r.id}">
                    <div class="swatch" style="background:${beerSwatchColor(r.beerStyle)};"></div>
                    <div class="body">
                        <div class="top-row">
                            <div>
                                <div class="name">${escapeHtml(r.beerName)}</div>
                                ${r.beerStyle ? `<div class="style">${escapeHtml(r.beerStyle)}</div>` : ""}
                            </div>
                            ${isNew ? `<span class="beer-chip new">New</span>` : ""}
                        </div>
                        <div class="meta-row">
                            ${r.abv ? `<span class="beer-chip abv">${r.abv}% ABV</span>` : ""}
                            <span class="beer-chip abv">${formatDate(r.releaseDate)}</span>
                        </div>
                        <div class="item-actions">
                            <button class="btn-pill outline small" data-action="edit">Edit</button>
                            <button class="btn-pill danger" data-action="delete">Delete</button>
                        </div>
                    </div>
                </div>
            `;
            }).join("");

            el.querySelectorAll(".beer-card").forEach(row => {
                const id = row.dataset.id;
                const r = releases.find(x => String(x.id) === id);
                row.querySelector('[data-action="edit"]').addEventListener("click", () => {
                    document.getElementById("release-id").value = r.id;
                    document.getElementById("release-name").value = r.beerName || "";
                    document.getElementById("release-style").value = r.beerStyle || "";
                    document.getElementById("release-desc").value = r.beerDescription || "";
                    document.getElementById("release-abv").value = r.abv ?? "";
                    document.getElementById("release-date").value = toDateInputValue(r.releaseDate);
                    document.getElementById("releases-form-title").textContent = "Edit release";
                    document.getElementById("release-submit-btn").textContent = "Save changes";
                    releaseCancelBtn.style.display = "inline-flex";
                    releaseForm.scrollIntoView({ behavior: "smooth" });
                });
                row.querySelector('[data-action="delete"]').addEventListener("click", async () => {
                    if (!confirm(`Delete "${r.beerName}"?`)) return;
                    try {
                        await HW.apiJson(`/api/beer-releases/${r.id}?breweryId=${breweryId}`, { method: "DELETE" });
                        loadReleases();
                    } catch (err) {
                        HW.showAlert(releasesAlert, err.message);
                    }
                });
            });
        } catch (err) {
            HW.showAlert(releasesAlert, err.message);
        }
    }

    releaseForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        HW.hideAlert(releasesAlert);
        const editingId = document.getElementById("release-id").value;
        const imageFile = document.getElementById("release-image").files[0];
        const abvValue = document.getElementById("release-abv").value;

        try {
            const payload = {
                beerName: document.getElementById("release-name").value.trim(),
                beerStyle: document.getElementById("release-style").value.trim() || null,
                beerDescription: document.getElementById("release-desc").value.trim() || null,
                abv: abvValue ? parseFloat(abvValue) : null,
                releaseDate: document.getElementById("release-date").value,
                imageBytes: imageFile ? await HW.fileToBase64(imageFile) : null
            };

            if (editingId) {
                await HW.apiJson(`/api/beer-releases/${editingId}`, {
                    method: "PUT",
                    body: JSON.stringify(Object.assign({ breweryId }, payload))
                });
            } else {
                await HW.apiJson(`/api/breweries/${breweryId}/beer-releases`, {
                    method: "POST",
                    body: JSON.stringify(payload)
                });
            }

            resetReleaseForm();
            loadReleases();
        } catch (err) {
            HW.showAlert(releasesAlert, err.message);
        }
    });

    // ── PROFILE ──────────────────────────────────────────────────────────────
    // brewery_profile's write endpoint upserts hours alongside profile fields
    // in one call (unconditionally — NULL included — unlike the dedicated
    // /hours PUT below, which only touches fields it's given), so whatever
    // this session last read into existingHours is what the contact form
    // sends back on every save. The Hours card's own save keeps this in sync
    // so a later contact-form save can't revert it to a stale value.
    let existingHours = {};

    const DAYS = [
        { key: "monday", label: "Monday" },
        { key: "tuesday", label: "Tuesday" },
        { key: "wednesday", label: "Wednesday" },
        { key: "thursday", label: "Thursday" },
        { key: "friday", label: "Friday" },
        { key: "saturday", label: "Saturday" },
        { key: "sunday", label: "Sunday" }
    ];

    function formatTime12h(hhmm) {
        const [h, m] = hhmm.split(":").map(Number);
        const period = h >= 12 ? "PM" : "AM";
        const h12 = h % 12 === 0 ? 12 : h % 12;
        return `${h12}:${String(m).padStart(2, "0")} ${period}`;
    }

    // One-line "Tue–Thu 4:00 PM–10:00 PM, Fri–Sat 12:00 PM–12:00 AM, Sun Closed"
    // summary for the collapsed hours dropdown — merges consecutive days that
    // share identical hours instead of listing all 7 every time.
    function summarizeHours(hours) {
        const dayAbbr = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };
        const entries = DAYS.map(d => {
            const openRaw = hours[`${d.key}Open`];
            const closeRaw = hours[`${d.key}Close`];
            const isOpen = !!openRaw && openRaw.slice(0, 5) !== "00:00";
            const text = isOpen
                ? `${formatTime12h(openRaw.slice(0, 5))}–${formatTime12h((closeRaw || "00:00:00").slice(0, 5))}`
                : "Closed";
            return { label: dayAbbr[d.key], text };
        });

        const groups = [];
        entries.forEach(e => {
            const last = groups[groups.length - 1];
            if (last && last.text === e.text) {
                last.labels.push(e.label);
            } else {
                groups.push({ text: e.text, labels: [e.label] });
            }
        });

        return groups.map(g => {
            const dayPart = g.labels.length > 1 ? `${g.labels[0]}–${g.labels[g.labels.length - 1]}` : g.labels[0];
            return `${dayPart} ${g.text}`;
        }).join(", ");
    }

    function renderHoursRows(hours) {
        document.getElementById("hours-summary").textContent = summarizeHours(hours);

        const el = document.getElementById("hours-rows");
        el.innerHTML = DAYS.map(d => {
            const openRaw = hours[`${d.key}Open`];
            const closeRaw = hours[`${d.key}Close`];
            const isOpen = !!openRaw && openRaw.slice(0, 5) !== "00:00";
            const openVal = isOpen ? openRaw.slice(0, 5) : "12:00";
            const closeVal = isOpen && closeRaw ? closeRaw.slice(0, 5) : "21:00";
            return `
                <div class="hours-row ${isOpen ? "" : "is-closed"}" data-day="${d.key}">
                    <span class="hours-day">${d.label}</span>
                    <label class="hours-open-toggle"><input type="checkbox" class="hours-open-check" ${isOpen ? "checked" : ""}> Open</label>
                    <input type="time" class="hours-open-time" value="${openVal}" ${isOpen ? "" : "disabled"}>
                    <span>–</span>
                    <input type="time" class="hours-close-time" value="${closeVal}" ${isOpen ? "" : "disabled"}>
                </div>
            `;
        }).join("");

        el.querySelectorAll(".hours-row").forEach(row => {
            const checkbox = row.querySelector(".hours-open-check");
            const openTime = row.querySelector(".hours-open-time");
            const closeTime = row.querySelector(".hours-close-time");
            checkbox.addEventListener("change", () => {
                row.classList.toggle("is-closed", !checkbox.checked);
                openTime.disabled = closeTime.disabled = !checkbox.checked;
            });
        });
    }

    wireSeriesToggles(document.getElementById("view-profile"));

    document.querySelectorAll('input[name="profile-food-type"]').forEach(radio => {
        radio.addEventListener("change", () => {
            document.getElementById("food-menu-field").style.display = radio.value === "kitchen" && radio.checked ? "flex" : "none";
        });
    });

    async function loadProfile() {
        document.getElementById("password-email-display").textContent = session.email || "your account email";

        try {
            const summary = await HW.apiJson(`/api/breweries/${breweryId}/dashboard-summary`);
            document.getElementById("brewery-name").value = summary.breweryName || "";
            document.getElementById("brewery-address").value = summary.streetAddress || "";
        } catch (err) {
            console.error(err);
        }

        try {
            const res = await HW.apiFetch(`/api/breweries/${breweryId}`);
            if (res.ok) {
                const b = await res.json();
                document.getElementById("brewery-phone").value = b.phoneNumber || "";
            }
        } catch (err) {
            console.error(err);
        }

        try {
            const hoursRes = await HW.apiFetch(`/api/breweries/${breweryId}/hours`);
            existingHours = hoursRes.ok ? await hoursRes.json() : {};
        } catch (err) {
            existingHours = {};
        }
        renderHoursRows(existingHours);

        try {
            const res = await HW.apiFetch(`/api/breweryprofile/${breweryId}`);
            if (res.ok) {
                const p = await res.json();
                document.getElementById("owner-name").value = p.ownerFullName || "";
                document.getElementById("owner-email").value = p.ownerEmail || "";
                document.getElementById("website-url").value = p.websiteUrl || "";
                document.getElementById("facebook-url").value = p.facebookUrl || "";
                document.getElementById("instagram-url").value = p.instagramUrl || "";
                document.getElementById("beer-menu-url").value = p.beerMenuUrl || "";
                document.getElementById("food-menu-url").value = p.foodMenuUrl || "";
                const hasKitchen = p.foodType === "kitchen";
                document.getElementById("food-type-kitchen").checked = hasKitchen;
                document.getElementById("food-type-none").checked = !hasKitchen;
                document.getElementById("food-menu-field").style.display = hasKitchen ? "flex" : "none";
            }
        } catch (err) {
            console.error(err);
        }
    }

    document.getElementById("hours-save-btn").addEventListener("click", async () => {
        const alertEl = document.getElementById("profile-alert");
        HW.hideAlert(alertEl);
        const payload = {};
        DAYS.forEach(d => {
            const row = document.querySelector(`#hours-rows .hours-row[data-day="${d.key}"]`);
            const open = row.querySelector(".hours-open-check").checked;
            const openVal = open ? row.querySelector(".hours-open-time").value : "00:00";
            const closeVal = open ? row.querySelector(".hours-close-time").value : "00:00";
            payload[`${d.key}Open`] = `${openVal}:00`;
            payload[`${d.key}Close`] = `${closeVal}:00`;
        });
        try {
            await HW.apiJson(`/api/breweries/${breweryId}/hours`, {
                method: "PUT",
                body: JSON.stringify(payload)
            });
            existingHours = payload;
            document.getElementById("hours-summary").textContent = summarizeHours(payload);
            HW.showAlert(alertEl, "Hours saved.", "success");
        } catch (err) {
            HW.showAlert(alertEl, err.message);
        }
    });

    document.getElementById("brewery-info-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const alertEl = document.getElementById("profile-alert");
        HW.hideAlert(alertEl);
        try {
            await HW.apiJson(`/api/breweries/${breweryId}`, {
                method: "PUT",
                body: JSON.stringify({
                    breweryName: document.getElementById("brewery-name").value.trim() || null,
                    streetAddress: document.getElementById("brewery-address").value.trim() || null,
                    phoneNumber: document.getElementById("brewery-phone").value.trim() || null
                })
            });
            session.breweryName = document.getElementById("brewery-name").value.trim();
            HW.setSession(session);
            document.getElementById("sidebar-brewery-name").textContent = session.breweryName;
            HW.showAlert(alertEl, "Brewery info saved.", "success");
        } catch (err) {
            HW.showAlert(alertEl, err.message);
        }
    });

    document.getElementById("brewery-contact-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const alertEl = document.getElementById("profile-alert");
        HW.hideAlert(alertEl);
        const foodType = document.querySelector('input[name="profile-food-type"]:checked').value;
        try {
            await HW.apiJson(`/api/breweryprofile/${breweryId}`, {
                method: "PUT",
                body: JSON.stringify({
                    breweryId,
                    ownerFullName: document.getElementById("owner-name").value.trim() || null,
                    ownerEmail: document.getElementById("owner-email").value.trim() || null,
                    websiteUrl: document.getElementById("website-url").value.trim() || null,
                    facebookUrl: document.getElementById("facebook-url").value.trim() || null,
                    instagramUrl: document.getElementById("instagram-url").value.trim() || null,
                    beermenuUrl: document.getElementById("beer-menu-url").value.trim() || null,
                    foodMenuUrl: foodType === "kitchen" ? (document.getElementById("food-menu-url").value.trim() || null) : null,
                    foodType,
                    mondayOpen: existingHours.mondayOpen ?? null,
                    mondayClose: existingHours.mondayClose ?? null,
                    tuesdayOpen: existingHours.tuesdayOpen ?? null,
                    tuesdayClose: existingHours.tuesdayClose ?? null,
                    wednesdayOpen: existingHours.wednesdayOpen ?? null,
                    wednesdayClose: existingHours.wednesdayClose ?? null,
                    thursdayOpen: existingHours.thursdayOpen ?? null,
                    thursdayClose: existingHours.thursdayClose ?? null,
                    fridayOpen: existingHours.fridayOpen ?? null,
                    fridayClose: existingHours.fridayClose ?? null,
                    saturdayOpen: existingHours.saturdayOpen ?? null,
                    saturdayClose: existingHours.saturdayClose ?? null,
                    sundayOpen: existingHours.sundayOpen ?? null,
                    sundayClose: existingHours.sundayClose ?? null
                })
            });
            HW.showAlert(alertEl, "Contact info saved.", "success");
        } catch (err) {
            HW.showAlert(alertEl, err.message);
        }
    });

    // ── CHANGE PASSWORD ──────────────────────────────────────────────────────
    // Same two-step code flow as forgot-password.html (there's no "verify
    // current password" endpoint to build an inline change-password form
    // against) — embedded here so a logged-in owner doesn't have to log out
    // to use it. Sends the code to session.email (the login email), not the
    // "Owner email" contact-info field above, which is a separate value the
    // reset endpoint doesn't look up accounts by.
    const passwordRequestForm = document.getElementById("password-request-form");
    const passwordResetForm = document.getElementById("password-reset-form");

    passwordRequestForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const alertEl = document.getElementById("password-alert");
        HW.hideAlert(alertEl);
        const btn = document.getElementById("password-request-btn");
        btn.disabled = true;
        btn.textContent = "Sending…";
        try {
            await HW.apiJson(`/api/password/request-reset`, {
                method: "POST",
                body: JSON.stringify({ email: session.email })
            });
            passwordRequestForm.style.display = "none";
            document.getElementById("password-step1-sub").textContent = `If ${session.email} is registered, a reset code is on its way.`;
            passwordResetForm.style.display = "block";
        } catch (err) {
            HW.showAlert(alertEl, err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = "Send Reset Code";
        }
    });

    passwordResetForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const alertEl = document.getElementById("password-alert");
        HW.hideAlert(alertEl);
        const btn = document.getElementById("password-reset-btn");
        btn.disabled = true;
        btn.textContent = "Updating…";
        try {
            await HW.apiJson(`/api/password/reset`, {
                method: "POST",
                body: JSON.stringify({
                    email: session.email,
                    code: document.getElementById("password-code").value.trim(),
                    newPassword: document.getElementById("password-new").value
                })
            });
            passwordResetForm.reset();
            passwordResetForm.style.display = "none";
            passwordRequestForm.style.display = "block";
            document.getElementById("password-step1-sub").textContent = "Send a reset code to your account email to update your password.";
            HW.showAlert(alertEl, "Password updated.", "success");
        } catch (err) {
            HW.showAlert(alertEl, err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = "Update Password";
        }
    });

    // ── ANALYTICS ────────────────────────────────────────────────────────────
    // Mirrors BreweryAnalyticsController's 7 endpoints — the same data the
    // app's own brewery analytics screen shows.
    const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    // WEEKDAY_LABELS[i]'s offset in days from a Monday week-start (perWeekday
    // arrays are Sun-first but weeks here always start Monday).
    const WEEKDAY_OFFSETS_FROM_MONDAY = [6, 0, 1, 2, 3, 4, 5];
    let guestStayWeekOffset = 0;
    let checkinsWeekOffset = 0;

    function miniStatHtml(label, value) {
        return `<div class="mini-stat"><div class="num">${value}</div><div class="label">${escapeHtml(label)}</div></div>`;
    }

    function ringChartHtml(segments, centerNum, centerLabel) {
        const total = segments.reduce((sum, seg) => sum + (seg.value || 0), 0);
        let acc = 0;
        const stops = total > 0
            ? segments.map(seg => {
                const start = (acc / total) * 360;
                acc += (seg.value || 0);
                const end = (acc / total) * 360;
                return `${seg.color} ${start}deg ${end}deg`;
            }).join(", ")
            : "var(--line) 0deg 360deg";
        const legend = segments.map(seg => `
            <div class="ring-legend-item">
                <span><span class="ring-legend-dot" style="background:${seg.color}"></span>${escapeHtml(seg.label)}</span>
                <strong>${seg.value ?? 0}</strong>
            </div>
        `).join("");
        return `
            <div class="ring-chart" style="background:conic-gradient(${stops})">
                <div class="ring-center"><div class="num">${centerNum}</div><div class="label">${escapeHtml(centerLabel)}</div></div>
            </div>
            <div class="ring-legend">${legend}</div>
        `;
    }

    function renderWeekdayChart(el, values, tooltips) {
        const max = Math.max(1, ...values);
        el.innerHTML = values.map((v, i) => `
            <div class="bar-col"${tooltips ? ` data-tooltip="${escapeHtml(tooltips[i])}"` : ""}>
                <div class="bar" style="height:${Math.max(2, Math.round((v / max) * 100))}%"></div>
                <div class="bar-label">${WEEKDAY_LABELS[i]}</div>
            </div>
        `).join("");
    }

    function starString(n) {
        const full = Math.max(0, Math.min(5, Math.round(n)));
        return "★".repeat(full) + "☆".repeat(5 - full);
    }

    function rankListHtml(rows, metricKey, metricLabel) {
        if (!rows || !rows.length) {
            return `<div class="empty-state">Not enough data yet</div>`;
        }
        return rows.map((r, i) => `
            <div class="rank-row">
                <div class="rank-badge r${i + 1}">${i + 1}</div>
                <div class="rank-info">
                    <div class="rank-title">${escapeHtml(r.title)}</div>
                    <div class="rank-meta">${formatDateTimeRange(r.startAt)} · ${r[metricKey]} ${metricLabel}</div>
                </div>
            </div>
        `).join("");
    }

    async function renderCheckins() {
        try {
            const checkins = await HW.apiJson(`/api/breweries/${breweryId}/analytics/checkins?weekOffset=${checkinsWeekOffset}`);
            document.getElementById("analytics-checkins").innerHTML = [
                miniStatHtml("Month to date", checkins.mtd),
                miniStatHtml("Year to date", checkins.ytd),
                miniStatHtml("Last 7 days", checkins.last7Days)
            ].join("");

            const values = checkins.perWeekdaySelectedWeek || [0, 0, 0, 0, 0, 0, 0];
            const tooltips = values.map((count, i) => {
                const d = new Date(`${checkins.weekStart}T00:00:00`);
                d.setDate(d.getDate() + WEEKDAY_OFFSETS_FROM_MONDAY[i]);
                return `${formatDate(d)}: ${count} check-in${count === 1 ? "" : "s"}`;
            });
            renderWeekdayChart(document.getElementById("analytics-checkins-chart"), values, tooltips);
        } catch (err) {
            HW.showAlert(document.getElementById("analytics-alert"), err.message);
        }
    }

    document.querySelectorAll("#checkins-weeks button").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#checkins-weeks button").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            checkinsWeekOffset = parseInt(btn.dataset.week, 10);
            renderCheckins();
        });
    });

    let guestStayIsYtd = false;

    async function renderGuestStay() {
        try {
            // ytdAvgMinutes comes back on every call regardless of weekOffset —
            // the YTD toggle just changes which fields this renders, not the
            // request made.
            const gs = await HW.apiJson(`/api/breweries/${breweryId}/analytics/guest-stay?weekOffset=${guestStayWeekOffset}`);
            document.getElementById("analytics-guest-stay").innerHTML = guestStayIsYtd
                ? [
                    miniStatHtml("Monthly avg", gs.monthlyAvgMinutes != null ? `${Math.round(gs.monthlyAvgMinutes)} min` : "—"),
                    miniStatHtml("Year to date avg", gs.ytdAvgMinutes != null ? `${Math.round(gs.ytdAvgMinutes)} min` : "—")
                ].join("")
                : [
                    miniStatHtml("Monthly avg", gs.monthlyAvgMinutes != null ? `${Math.round(gs.monthlyAvgMinutes)} min` : "—"),
                    miniStatHtml("Selected week avg", gs.weeklyAvgMinutes != null ? `${Math.round(gs.weeklyAvgMinutes)} min` : "—")
                ].join("");

            const chartEl = document.getElementById("analytics-guest-stay-chart");
            const noteEl = document.getElementById("analytics-guest-stay-ytd-note");
            if (guestStayIsYtd) {
                chartEl.style.display = "none";
                noteEl.style.display = "block";
            } else {
                chartEl.style.display = "";
                noteEl.style.display = "none";
                renderWeekdayChart(
                    chartEl,
                    (gs.perWeekdayAvgMinutes || [0, 0, 0, 0, 0, 0, 0]).map(v => Math.round(v))
                );
            }
        } catch (err) {
            HW.showAlert(document.getElementById("analytics-alert"), err.message);
        }
    }

    document.querySelectorAll("#guest-stay-weeks button").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#guest-stay-weeks button").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            guestStayIsYtd = btn.dataset.week === "ytd";
            if (!guestStayIsYtd) guestStayWeekOffset = parseInt(btn.dataset.week, 10);
            renderGuestStay();
        });
    });

    // Reviews range toggle (Last 30 Days / Year to Date) — split out of the
    // big analytics Promise.all below so flipping it only refetches ratings,
    // not followers/loyalty/events/out-of-town too.
    let reviewsYtd = false;

    async function loadRatings() {
        const alertEl = document.getElementById("analytics-alert");
        try {
            const ratings = await HW.apiJson(`/api/breweries/${breweryId}/analytics/ratings?ytd=${reviewsYtd}`);
            const avg = ratings.lifetimeAvgRating;
            const pct = avg != null ? Math.round((avg / 5) * 100) : null;
            let mood = "No ratings yet", moodClass = "flat";
            if (pct != null) {
                if (pct >= 90) { mood = "Superb!"; moodClass = "up"; }
                else if (pct >= 75) { mood = "Great!"; moodClass = "up"; }
                else if (pct >= 60) { mood = "Good"; moodClass = "flat"; }
                else { mood = "Needs attention"; moodClass = "down"; }
            }
            document.getElementById("analytics-ratings-sentiment").innerHTML = `
                <div class="sentiment-ring ${moodClass}" style="--pct:${pct ?? 0}">
                    <div class="sentiment-pct">${pct != null ? pct + "%" : "—"}</div>
                </div>
                <div class="sentiment-mood">${escapeHtml(mood)}</div>
                <div class="sentiment-stars">${avg != null ? starString(avg) : ""}</div>
            `;
            document.getElementById("analytics-ratings-summary").innerHTML = [
                miniStatHtml("Avg rating", avg != null ? avg.toFixed(1) : "—"),
                miniStatHtml("Reviews", ratings.lifetimeCount)
            ].join("");
            const reviewsEl = document.getElementById("analytics-reviews");
            if (!ratings.reviews || !ratings.reviews.length) {
                reviewsEl.innerHTML = `<div class="empty-state">No reviews ${reviewsYtd ? "yet this year" : "in the last 30 days"}.</div>`;
            } else {
                reviewsEl.innerHTML = ratings.reviews.map(r => {
                    const n = Math.max(1, Math.min(5, Math.round(r.stars)));
                    return `
                        <div class="review-item">
                            <div class="review-top">
                                <div class="review-rating-badge r${n}">${n}★</div>
                                <div class="stars">${starString(r.stars)}</div>
                            </div>
                            ${r.message ? `<div class="msg">${escapeHtml(r.message)}</div>` : ""}
                            <div class="when">${formatDate(r.createdAt)}</div>
                        </div>
                    `;
                }).join("");
            }
        } catch (err) {
            HW.showAlert(alertEl, err.message);
        }
    }

    function updateReviewsRangeLabel() {
        document.getElementById("reviews-range-label").textContent = reviewsYtd ? "Year to Date" : "Last 30 Days";
    }

    ["reviews-range-prev", "reviews-range-next"].forEach(id => {
        document.getElementById(id).addEventListener("click", () => {
            reviewsYtd = !reviewsYtd;
            updateReviewsRangeLabel();
            loadRatings();
        });
    });

    async function loadAnalytics() {
        const alertEl = document.getElementById("analytics-alert");
        HW.hideAlert(alertEl);

        loadRatings();

        const [followers, loyalty, events, outOfTown] = await Promise.all([
            HW.apiJson(`/api/breweries/${breweryId}/analytics/followers`).catch(() => null),
            HW.apiJson(`/api/breweries/${breweryId}/analytics/checkin-loyalty`).catch(() => null),
            HW.apiJson(`/api/breweries/${breweryId}/analytics/events`).catch(() => null),
            HW.apiJson(`/api/breweries/${breweryId}/analytics/out-of-town`).catch(() => null)
        ]);

        if (!followers && !events) {
            HW.showAlert(alertEl, "Couldn't load analytics right now.");
        }

        if (followers) {
            document.getElementById("followers-total").textContent = followers.totalFollowers;
            const net = followers.thisWeekNet;
            const trendEl = document.getElementById("followers-trend-pill");
            trendEl.textContent = `${net > 0 ? "+" : ""}${net} this week`;
            trendEl.className = "trend-pill " + (net > 0 ? "up" : net < 0 ? "down" : "flat");
            document.getElementById("analytics-followers").innerHTML = [
                miniStatHtml("This month (net)", (followers.thisMonthNet > 0 ? "+" : "") + followers.thisMonthNet),
                miniStatHtml("Vs. last month", followers.monthOverMonthPercentChange == null ? "—" : `${followers.monthOverMonthPercentChange > 0 ? "+" : ""}${followers.monthOverMonthPercentChange}%`),
                miniStatHtml("Unfollowed", followers.removalsThisMonth)
            ].join("");
        }

        if (loyalty) {
            const segs = [
                { value: loyalty.once, color: "var(--chart-blue)", label: "1 visit" },
                { value: loyalty.twoToFive, color: "var(--chart-green)", label: "2–5 visits" },
                { value: loyalty.sixPlus, color: "var(--amber)", label: "6+ visits" }
            ];
            const total = segs.reduce((sum, s) => sum + (s.value || 0), 0);
            document.getElementById("analytics-loyalty").innerHTML = ringChartHtml(segs, total, "Visitors");
        }

        if (events) {
            document.getElementById("analytics-events-summary").innerHTML = [
                miniStatHtml("Events (30d)", events.totalEvents30d),
                miniStatHtml("Shares (YTD)", events.ytdShared),
                miniStatHtml("Likes (YTD)", events.ytdLikes),
                miniStatHtml("Saves (YTD)", events.ytdSaved)
            ].join("");

            const engSegs = [
                { value: events.ytdShared, color: "var(--chart-blue)", label: "Shares" },
                { value: events.ytdLikes, color: "var(--amber)", label: "Likes" },
                { value: events.ytdSaved, color: "var(--chart-green)", label: "Saves" }
            ];
            const engTotal = engSegs.reduce((sum, s) => sum + (s.value || 0), 0);
            document.getElementById("analytics-engagement").innerHTML = ringChartHtml(engSegs, engTotal, "Total");

            document.getElementById("analytics-top-shared").innerHTML = rankListHtml(events.top3Shared, "shared", "shares");
            document.getElementById("analytics-top-liked").innerHTML = rankListHtml(events.top3Liked, "likes", "likes");
            document.getElementById("analytics-top-saved").innerHTML = rankListHtml(events.top3Saved, "saved", "saves");

            const recentEl = document.getElementById("analytics-events-recent");
            if (!events.recent || !events.recent.length) {
                recentEl.innerHTML = `<div class="empty-state">No events in the last 30 days.</div>`;
            } else {
                recentEl.innerHTML = events.recent.map(ev => `
                    <div class="item-row">
                        <div class="item-info">
                            <div class="item-title">${escapeHtml(ev.title)}</div>
                            <div class="item-meta">${formatDate(ev.startAt)} · ${ev.likes} likes · ${ev.shared} shares · ${ev.saved} saves</div>
                        </div>
                    </div>
                `).join("");
            }
        }

        if (outOfTown) {
            document.getElementById("analytics-out-of-town").innerHTML = [
                miniStatHtml("Out-of-town guests (30d)", outOfTown.count30d),
                miniStatHtml("Busiest day", outOfTown.busiestDay ? formatDate(outOfTown.busiestDay) : "—")
            ].join("") + (outOfTown.busiestDay ? `<p class="section-sub" style="margin-top:12px;">Likely reason: ${escapeHtml(outOfTown.reason)}</p>` : "");
        }

        await Promise.all([renderGuestStay(), renderCheckins()]);
    }

    // ── ADD LOCATION (multi-location parent accounts) ───────────────────────
    const addLocationBtn = document.getElementById("add-location-btn");
    const addLocationOverlay = document.getElementById("add-location-overlay");
    const addLocationPanel = document.getElementById("add-location-panel");
    const locationCreatedPanel = document.getElementById("location-created-panel");
    const addLocationAlert = document.getElementById("add-location-alert");
    const locationCreatedAlert = document.getElementById("location-created-alert");
    const locationSearchEl = document.getElementById("location-search");
    const locationSuggestionsEl = document.getElementById("location-suggestions");
    const newLocationNameEl = document.getElementById("new-location-name");
    const newLocationAddressEl = document.getElementById("new-location-address");
    const newLocationEmailEl = document.getElementById("new-location-email");
    let pickedLocation = null;
    let locationSearchDebounce = null;
    let lastCreatedEmail = "";
    let lastCreatedTempPass = "";

    // Profile's "Locations" card — lets a parent account raise its own cap
    // (no billing, just the max_locations field) so a single-location account
    // can grow into one that's allowed to use Add Location.
    const locationsCard = document.getElementById("locations-card");
    const locationsStatusSub = document.getElementById("locations-status-sub");
    const locationsMaxInput = document.getElementById("locations-max");
    const locationsForm = document.getElementById("locations-form");
    const locationsAlert = document.getElementById("locations-alert");

    // Only parent accounts on a multi-location plan, under their cap, can add
    // a location — mirrors BreweryHomePage.xaml.cs's ApplyRoleVisibilityAsync;
    // the server re-validates this on every call regardless. Also drives the
    // Profile "Locations" card: hidden entirely for a child (non-parent)
    // account, since location management only makes sense for the primary.
    function applyAccountStatus(status) {
        addLocationBtn.style.display = status.canAddLocations ? "block" : "none";

        locationsCard.hidden = !status.isParentAccount;
        if (!status.isParentAccount) return;

        const cap = status.maxLocations ?? 1;
        locationsStatusSub.textContent = `Using ${status.ownedLocationCount} of ${cap} location${cap === 1 ? "" : "s"}.`;
        locationsMaxInput.value = cap;
        locationsMaxInput.min = status.ownedLocationCount || 1;
    }

    function refreshAccountStatus() {
        return HW.apiJson(`/api/breweries/${breweryId}/account-status`)
            .then(applyAccountStatus)
            .catch(err => console.error(err));
    }

    refreshAccountStatus();

    locationsForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        HW.hideAlert(locationsAlert);
        try {
            const status = await HW.apiJson(`/api/breweries/${breweryId}/max-locations`, {
                method: "PUT",
                body: JSON.stringify({ maxLocations: parseInt(locationsMaxInput.value, 10) })
            });
            applyAccountStatus(status);
            HW.showAlert(locationsAlert, status.canAddLocations ? "Saved — Add Location is now available in the sidebar." : "Saved.", "success");
        } catch (err) {
            HW.showAlert(locationsAlert, err.message);
        }
    });

    function resetAddLocationForm() {
        pickedLocation = null;
        locationSearchEl.value = "";
        locationSuggestionsEl.style.display = "none";
        newLocationNameEl.value = "";
        newLocationAddressEl.value = "";
        newLocationEmailEl.value = "";
        HW.hideAlert(addLocationAlert);
    }

    addLocationBtn.addEventListener("click", () => {
        resetAddLocationForm();
        addLocationPanel.style.display = "block";
        locationCreatedPanel.style.display = "none";
        addLocationOverlay.style.display = "flex";
    });

    document.getElementById("add-location-cancel").addEventListener("click", () => {
        addLocationOverlay.style.display = "none";
    });

    locationSearchEl.addEventListener("input", () => {
        const term = locationSearchEl.value.trim();
        pickedLocation = null;
        clearTimeout(locationSearchDebounce);
        if (term.length < 2) {
            locationSuggestionsEl.style.display = "none";
            return;
        }
        locationSearchDebounce = setTimeout(async () => {
            try {
                const results = await HW.apiJson(`/api/breweries/${breweryId}/unclaimed-search?term=${encodeURIComponent(term)}`);
                if (!results.length) {
                    locationSuggestionsEl.style.display = "none";
                    return;
                }
                locationSuggestionsEl.innerHTML = results.map(b => `
                    <div class="brewery-suggestion-item" data-id="${b.breweryId}" data-name="${escapeHtml(b.breweryName)}">
                        <div>${escapeHtml(b.breweryName)}</div>
                        ${b.streetAddress ? `<div class="addr">${escapeHtml(b.streetAddress)}</div>` : ""}
                    </div>
                `).join("");
                locationSuggestionsEl.style.display = "block";
            } catch {
                locationSuggestionsEl.style.display = "none";
            }
        }, 350);
    });

    locationSuggestionsEl.addEventListener("click", (e) => {
        const item = e.target.closest(".brewery-suggestion-item");
        if (!item) return;
        pickedLocation = { breweryId: parseInt(item.dataset.id, 10), breweryName: item.dataset.name };
        locationSearchEl.value = item.dataset.name;
        locationSuggestionsEl.style.display = "none";
        newLocationNameEl.value = "";
        newLocationAddressEl.value = "";
    });

    document.addEventListener("click", (e) => {
        if (!e.target.closest(".brewery-search-wrap")) locationSuggestionsEl.style.display = "none";
    });

    document.getElementById("add-location-save").addEventListener("click", async () => {
        const email = newLocationEmailEl.value.trim().toLowerCase();
        const newName = newLocationNameEl.value.trim();
        const newAddress = newLocationAddressEl.value.trim();
        const usingPicker = !!pickedLocation;
        const usingManual = !!newName && !!newAddress;

        if (!email || (!usingPicker && !usingManual)) {
            HW.showAlert(addLocationAlert, "Pick a location from the list (or enter a new one), and provide a login email.");
            return;
        }

        try {
            // Temp password is generated server-side and returned exactly once —
            // same contract as BreweriesController.AddLocation.
            const result = await HW.apiJson(`/api/breweries/${breweryId}/locations`, {
                method: "POST",
                body: JSON.stringify({
                    email,
                    existingBreweryId: usingPicker ? pickedLocation.breweryId : null,
                    newBreweryName: usingPicker ? null : newName,
                    newBreweryAddress: usingPicker ? null : newAddress
                })
            });

            lastCreatedEmail = result.email;
            lastCreatedTempPass = result.tempPassword;

            document.getElementById("created-location-name").textContent = result.createdBreweryName;
            document.getElementById("created-location-email").textContent = result.email;
            document.getElementById("created-location-temp-pass").textContent = result.tempPassword;

            HW.hideAlert(locationCreatedAlert);
            addLocationPanel.style.display = "none";
            locationCreatedPanel.style.display = "block";
        } catch (err) {
            HW.showAlert(addLocationAlert, err.message);
        }
    });

    document.getElementById("copy-location-credentials").addEventListener("click", async () => {
        const text = `HopWire login\nEmail: ${lastCreatedEmail}\nTemp Password: ${lastCreatedTempPass}`;
        try {
            await navigator.clipboard.writeText(text);
            HW.showAlert(locationCreatedAlert, "Credentials copied — text or email them to your location.", "success");
        } catch {
            HW.showAlert(locationCreatedAlert, "Couldn't copy automatically — select the text above and copy it manually.");
        }
    });

    document.getElementById("dismiss-location-created").addEventListener("click", () => {
        addLocationOverlay.style.display = "none";
        lastCreatedEmail = "";
        lastCreatedTempPass = "";
    });

    // Kick off with the overview tab.
    loadOverview();
    loaded.overview = true;
}
