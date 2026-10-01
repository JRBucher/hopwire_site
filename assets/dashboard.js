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
            const events = await HW.apiJson(`/api/breweries/${breweryId}/events?userId=0&window=upcoming`);
            const el = document.getElementById("overview-upcoming");
            if (!events.length) {
                el.innerHTML = `<div class="empty-state">No upcoming events yet — add one from the Events tab.</div>`;
                return;
            }
            el.innerHTML = events.slice(0, 5).map(ev => `
                <div class="item-row">
                    <div class="item-info">
                        <div class="item-title">${escapeHtml(ev.title)}</div>
                        <div class="item-meta">${formatDateTimeRange(ev.startAt, ev.endAt)}</div>
                    </div>
                </div>
            `).join("");
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

    function renderEventRow(ev, isPast) {
        const actions = isPast
            ? `<button class="btn-pill outline small" data-action="photos">View Photos</button>
               <button class="btn-pill danger" data-action="delete">Delete</button>`
            : `<button class="btn-pill outline small" data-action="edit">Edit</button>
               <button class="btn-pill danger" data-action="delete">Delete</button>`;
        return `
            <div class="item-row ${isPast ? "is-past" : ""}" data-id="${ev.id}" style="align-items:flex-start;">
                <div class="item-info">
                    <div class="item-title">${escapeHtml(ev.title)}</div>
                    <div class="item-meta">${formatDateTimeRange(ev.startAt, ev.endAt)}</div>
                    ${isPast ? `<div class="photo-panel" style="display:none;"></div>` : ""}
                </div>
                <div class="item-actions">${actions}</div>
            </div>
        `;
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
                ? upcoming.map(ev => renderEventRow(ev, false)).join("")
                : `<div class="empty-state">Nothing on the calendar yet — post your first event above.</div>`;
            upcomingEl.querySelectorAll(".item-row").forEach(row => wireEventRow(row, events));

            const pastEl = document.getElementById("events-past-list");
            pastEl.innerHTML = past.length
                ? past.map(ev => renderEventRow(ev, true)).join("")
                : `<div class="empty-state">No past events yet.</div>`;
            pastEl.querySelectorAll(".item-row").forEach(row => wireEventRow(row, events));
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

    async function loadSpecials() {
        try {
            const specials = await HW.apiJson(`/api/breweries/${breweryId}/specials`);
            const el = document.getElementById("specials-list");
            const upcoming = specials.filter(s => new Date(s.date) >= new Date(new Date().toDateString()));
            if (!upcoming.length) {
                el.innerHTML = `<div class="empty-state">No specials on deck — line one up above.</div>`;
                return;
            }
            el.innerHTML = upcoming.slice(0, 30).map(s => `
                <div class="item-row" data-id="${s.id}">
                    <div class="item-info">
                        <div class="item-title">${escapeHtml(s.message)}</div>
                        <div class="item-meta">${formatDate(s.date)}</div>
                    </div>
                    <div class="item-actions">
                        <button class="btn-pill danger" data-action="delete">Delete</button>
                    </div>
                </div>
            `).join("");

            el.querySelectorAll(".item-row").forEach(row => {
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
            });
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

    async function loadReleases() {
        try {
            const releases = await HW.apiJson(`/api/breweries/${breweryId}/beer-releases`);
            const el = document.getElementById("releases-list");
            if (!releases.length) {
                el.innerHTML = `<div class="empty-state">Nothing brewing yet — post your first release above.</div>`;
                return;
            }
            el.innerHTML = releases.map(r => `
                <div class="item-row" data-id="${r.id}">
                    <div class="item-info">
                        <div class="item-title">${escapeHtml(r.beerName)}${r.beerStyle ? ` — ${escapeHtml(r.beerStyle)}` : ""}</div>
                        <div class="item-meta">${formatDate(r.releaseDate)}${r.abv ? ` · ${r.abv}% ABV` : ""}</div>
                    </div>
                    <div class="item-actions">
                        <button class="btn-pill outline small" data-action="edit">Edit</button>
                        <button class="btn-pill danger" data-action="delete">Delete</button>
                    </div>
                </div>
            `).join("");

            el.querySelectorAll(".item-row").forEach(row => {
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
    // in one call, so the hours this session read on load are sent back
    // unchanged — this dashboard doesn't expose hours editing yet, and saving
    // without them would silently null the brewery's existing hours out.
    let existingHours = {};

    async function loadProfile() {
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

        try {
            const res = await HW.apiFetch(`/api/breweryprofile/${breweryId}`);
            if (res.ok) {
                const p = await res.json();
                document.getElementById("owner-name").value = p.ownerFullName || "";
                document.getElementById("owner-email").value = p.ownerEmail || "";
                document.getElementById("website-url").value = p.websiteUrl || "";
                document.getElementById("facebook-url").value = p.facebookUrl || "";
                document.getElementById("instagram-url").value = p.instagramUrl || "";
                document.getElementById("food-type").value = p.foodType || "";
            }
        } catch (err) {
            console.error(err);
        }
    }

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
                    beermenuUrl: null,
                    foodMenuUrl: null,
                    foodType: document.getElementById("food-type").value.trim() || null,
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

    // ── ANALYTICS ────────────────────────────────────────────────────────────
    // Mirrors BreweryAnalyticsController's 7 endpoints — the same data the
    // app's own brewery analytics screen shows.
    const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let guestStayWeekOffset = 0;

    function miniStatHtml(label, value) {
        return `<div class="mini-stat"><div class="num">${value}</div><div class="label">${escapeHtml(label)}</div></div>`;
    }

    function renderWeekdayChart(el, values) {
        const max = Math.max(1, ...values);
        el.innerHTML = values.map((v, i) => `
            <div class="bar-col">
                <div class="bar" style="height:${Math.max(2, Math.round((v / max) * 100))}%"></div>
                <div class="bar-label">${WEEKDAY_LABELS[i]}</div>
            </div>
        `).join("");
    }

    function starString(n) {
        const full = Math.max(0, Math.min(5, Math.round(n)));
        return "★".repeat(full) + "☆".repeat(5 - full);
    }

    function tagListHtml(arr) {
        return arr && arr.length
            ? arr.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")
            : `<span style="color:var(--muted); font-size:0.85rem;">Not enough data yet</span>`;
    }

    async function renderGuestStay() {
        try {
            const gs = await HW.apiJson(`/api/breweries/${breweryId}/analytics/guest-stay?weekOffset=${guestStayWeekOffset}`);
            document.getElementById("analytics-guest-stay").innerHTML = [
                miniStatHtml("Monthly avg", gs.monthlyAvgMinutes != null ? `${Math.round(gs.monthlyAvgMinutes)} min` : "—"),
                miniStatHtml("Selected week avg", gs.weeklyAvgMinutes != null ? `${Math.round(gs.weeklyAvgMinutes)} min` : "—")
            ].join("");
            renderWeekdayChart(
                document.getElementById("analytics-guest-stay-chart"),
                (gs.perWeekdayAvgMinutes || [0, 0, 0, 0, 0, 0, 0]).map(v => Math.round(v))
            );
        } catch (err) {
            HW.showAlert(document.getElementById("analytics-alert"), err.message);
        }
    }

    document.querySelectorAll("#guest-stay-weeks button").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#guest-stay-weeks button").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            guestStayWeekOffset = parseInt(btn.dataset.week, 10);
            renderGuestStay();
        });
    });

    async function loadAnalytics() {
        const alertEl = document.getElementById("analytics-alert");
        HW.hideAlert(alertEl);

        const [followers, checkins, loyalty, ratings, events, outOfTown] = await Promise.all([
            HW.apiJson(`/api/breweries/${breweryId}/analytics/followers`).catch(() => null),
            HW.apiJson(`/api/breweries/${breweryId}/analytics/checkins`).catch(() => null),
            HW.apiJson(`/api/breweries/${breweryId}/analytics/checkin-loyalty`).catch(() => null),
            HW.apiJson(`/api/breweries/${breweryId}/analytics/ratings`).catch(() => null),
            HW.apiJson(`/api/breweries/${breweryId}/analytics/events`).catch(() => null),
            HW.apiJson(`/api/breweries/${breweryId}/analytics/out-of-town`).catch(() => null)
        ]);

        if (!followers && !checkins && !ratings && !events) {
            HW.showAlert(alertEl, "Couldn't load analytics right now.");
        }

        if (followers) {
            document.getElementById("analytics-followers").innerHTML = [
                miniStatHtml("Total followers", followers.totalFollowers),
                miniStatHtml("This week (net)", (followers.thisWeekNet > 0 ? "+" : "") + followers.thisWeekNet),
                miniStatHtml("This month (net)", (followers.thisMonthNet > 0 ? "+" : "") + followers.thisMonthNet),
                miniStatHtml("Vs. last month", followers.monthOverMonthPercentChange == null ? "—" : `${followers.monthOverMonthPercentChange > 0 ? "+" : ""}${followers.monthOverMonthPercentChange}%`),
                miniStatHtml("Unfollowed this month", followers.removalsThisMonth)
            ].join("");
        }

        if (checkins) {
            document.getElementById("analytics-checkins").innerHTML = [
                miniStatHtml("Month to date", checkins.mtd),
                miniStatHtml("Year to date", checkins.ytd),
                miniStatHtml("Last 7 days", checkins.last7Days)
            ].join("");
            renderWeekdayChart(document.getElementById("analytics-checkins-chart"), checkins.perWeekday || [0, 0, 0, 0, 0, 0, 0]);
        }

        if (loyalty) {
            document.getElementById("analytics-loyalty").innerHTML = [
                miniStatHtml("1 visit", loyalty.once),
                miniStatHtml("2–5 visits", loyalty.twoToFive),
                miniStatHtml("6+ visits", loyalty.sixPlus)
            ].join("");
        }

        if (ratings) {
            document.getElementById("analytics-ratings-summary").innerHTML = [
                miniStatHtml("Lifetime avg rating", ratings.lifetimeAvgRating != null ? ratings.lifetimeAvgRating.toFixed(1) : "—"),
                miniStatHtml("Lifetime reviews", ratings.lifetimeCount)
            ].join("");
            const reviewsEl = document.getElementById("analytics-reviews");
            if (!ratings.reviews || !ratings.reviews.length) {
                reviewsEl.innerHTML = `<div class="empty-state">No reviews in the last 30 days.</div>`;
            } else {
                reviewsEl.innerHTML = ratings.reviews.map(r => `
                    <div class="review-item">
                        <div class="stars">${starString(r.stars)}</div>
                        ${r.message ? `<div class="msg">${escapeHtml(r.message)}</div>` : ""}
                        <div class="when">${formatDate(r.createdAt)}</div>
                    </div>
                `).join("");
            }
        }

        if (events) {
            document.getElementById("analytics-events-summary").innerHTML = [
                miniStatHtml("Events (30d)", events.totalEvents30d),
                miniStatHtml("Shares (YTD)", events.ytdShared),
                miniStatHtml("Likes (YTD)", events.ytdLikes),
                miniStatHtml("Saves (YTD)", events.ytdSaved)
            ].join("");

            document.getElementById("analytics-top-shared").innerHTML = tagListHtml(events.top3Shared);
            document.getElementById("analytics-top-liked").innerHTML = tagListHtml(events.top3Liked);
            document.getElementById("analytics-top-saved").innerHTML = tagListHtml(events.top3Saved);

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

        await renderGuestStay();
    }

    // Kick off with the overview tab.
    loadOverview();
    loaded.overview = true;
}
