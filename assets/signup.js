// Brewery owner signup wizard — mirrors the MAUI app's 4-step flow
// (BusinessPageSignUp → BrewerySelectionPage → BreweryNumLocationPage →
// BreweryCheckoutPage): nothing is written to the DB until Stripe checkout
// completes, so an abandoned signup never leaves an orphaned account.
//
// Step 4's "Complete Subscription" hands off to Stripe's hosted checkout —
// the browser actually navigates away and back, so all wizard state is
// stashed in sessionStorage first; signup-complete.html reads it back on
// return and finishes account creation (see that file for steps 5+).
const STORAGE_KEY = "hw_signup_wizard";

// Brewery name/address come straight from the API (any brewery owner can set
// their own via signup or "Add a Location"), so they're untrusted for HTML —
// same helper dashboard.js already uses for the same class of data.
function escapeHtml(str) {
    return (str ?? "").toString().replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

const TIERS = [
    { key: "1 Location", label: "1 Location", price: 99, maxLocations: 1 },
    { key: "2–5 Locations", label: "2–5 Locations", price: 199, maxLocations: 5 },
    { key: "6–10 Locations", label: "6–10 Locations", price: 299, maxLocations: 10 },
    { key: "11+ Locations", label: "11+ Locations", price: 499, maxLocations: 999999 }
];

const DAYS = [
    { key: "monday", label: "Monday" },
    { key: "tuesday", label: "Tuesday" },
    { key: "wednesday", label: "Wednesday" },
    { key: "thursday", label: "Thursday" },
    { key: "friday", label: "Friday" },
    { key: "saturday", label: "Saturday" },
    { key: "sunday", label: "Sunday" }
];

// Every signup now gets the same regular tier price with a 3-month free
// trial (see the backend's StripeEndpoints — it sets TrialEnd 3 months out
// on every checkout session). This just renders the matching due-date copy;
// the backend is authoritative for the actual billing date.
function formatFirstChargeDate() {
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function loadState() {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function saveState() {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const state = Object.assign({
    ownerName: "", email: "", password: "",
    breweryName: "", isNewBrewery: false, existingBreweryId: 0,
    address: "", phone: "",
    websiteUrl: "", facebookUrl: "", instagramUrl: "", beerMenuUrl: "",
    foodType: "none", foodMenuUrl: "",
    hours: DAYS.reduce((acc, d) => {
        acc[d.key] = { open: true, openTime: "12:00", closeTime: "21:00" };
        return acc;
    }, {}),
    tierKey: "", tierLabel: "", monthlyPrice: 0, maxLocations: 1
}, loadState());

const alertEl = document.getElementById("alert");
let currentStep = 1;

function goToStep(n) {
    document.querySelectorAll(".wizard-step").forEach(el => el.classList.toggle("active", el.id === `wizard-step-${n}`));
    document.querySelectorAll("#wizard-progress .step").forEach(el => {
        const stepNum = parseInt(el.dataset.step, 10);
        el.classList.toggle("active", stepNum === n);
        el.classList.toggle("done", stepNum < n);
    });
    currentStep = n;
    HW.hideAlert(alertEl);
    window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── STEP 1: ACCOUNT ─────────────────────────────────────────────────────────
document.getElementById("ownerName").value = state.ownerName;
document.getElementById("email").value = state.email;

document.querySelector('#wizard-step-1 [data-next]').addEventListener("click", () => {
    const ownerName = document.getElementById("ownerName").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (!ownerName || !email || !password || !confirmPassword) {
        HW.showAlert(alertEl, "Please fill in all fields.");
        return;
    }
    if (!email.includes("@") || !email.includes(".")) {
        HW.showAlert(alertEl, "Please enter a valid email address.");
        return;
    }
    if (password !== confirmPassword) {
        HW.showAlert(alertEl, "Passwords don't match.");
        return;
    }
    if (password.length < 8) {
        HW.showAlert(alertEl, "Password must be at least 8 characters.");
        return;
    }

    state.ownerName = ownerName;
    state.email = email;
    state.password = password;
    saveState();
    goToStep(2);
});

// ── STEP 2: BREWERY DETAILS ──────────────────────────────────────────────────
const breweryQueryEl = document.getElementById("breweryQuery");
const suggestionsEl = document.getElementById("brewery-suggestions");
const manualToggle = document.getElementById("manual-entry-toggle");
const manualField = document.getElementById("manual-brewery-field");
const manualNameInput = document.getElementById("manualBreweryName");
let searchDebounce = null;
let showingManualEntry = false;

async function searchBreweries(query) {
    try {
        const res = await fetch(`${HW.API_BASE}/api/breweries/search?query=${encodeURIComponent(query)}&limit=20`);
        if (!res.ok) return [];
        return await res.json();
    } catch {
        return [];
    }
}

breweryQueryEl.addEventListener("input", () => {
    const query = breweryQueryEl.value.trim();
    state.existingBreweryId = 0;
    clearTimeout(searchDebounce);
    if (query.length < 2) {
        suggestionsEl.style.display = "none";
        return;
    }
    searchDebounce = setTimeout(async () => {
        const results = await searchBreweries(query);
        if (!results.length) {
            suggestionsEl.style.display = "none";
            return;
        }
        suggestionsEl.innerHTML = results.map(b => `
            <div class="brewery-suggestion-item" data-id="${b.breweryId}" data-name="${escapeHtml(b.breweryName)}" data-address="${escapeHtml(b.streetAddress)}" data-phone="${escapeHtml(b.phoneNumber)}">
                <div>${escapeHtml(b.breweryName)}</div>
                ${b.streetAddress ? `<div class="addr">${escapeHtml(b.streetAddress)}</div>` : ""}
            </div>
        `).join("");
        suggestionsEl.style.display = "block";
    }, 350);
});

suggestionsEl.addEventListener("click", (e) => {
    const item = e.target.closest(".brewery-suggestion-item");
    if (!item) return;
    breweryQueryEl.value = item.dataset.name;
    state.breweryName = item.dataset.name;
    state.existingBreweryId = parseInt(item.dataset.id, 10);
    state.isNewBrewery = false;
    if (item.dataset.phone) document.getElementById("breweryPhone").value = item.dataset.phone;
    if (item.dataset.address) document.getElementById("breweryAddress").value = item.dataset.address;
    suggestionsEl.style.display = "none";
    showingManualEntry = false;
    manualField.style.display = "none";
});

document.addEventListener("click", (e) => {
    if (!e.target.closest(".brewery-search-wrap")) suggestionsEl.style.display = "none";
});

manualToggle.addEventListener("click", (e) => {
    e.preventDefault();
    showingManualEntry = true;
    state.existingBreweryId = 0;
    state.isNewBrewery = true;
    breweryQueryEl.value = "";
    suggestionsEl.style.display = "none";
    manualField.style.display = "block";
    manualNameInput.focus();
});

// ── Food type toggle ──
document.querySelectorAll('input[name="foodType"]').forEach(radio => {
    radio.addEventListener("change", () => {
        document.getElementById("food-menu-field").style.display = radio.value === "kitchen" && radio.checked ? "block" : "none";
    });
});

// ── Hours rows ──
const hoursRowsEl = document.getElementById("hours-rows");
hoursRowsEl.innerHTML = DAYS.map(d => {
    const h = state.hours[d.key];
    return `
        <div class="hours-row ${h.open ? "" : "is-closed"}" data-day="${d.key}">
            <span class="hours-day">${d.label}</span>
            <label class="hours-open-toggle"><input type="checkbox" class="hours-open-check" ${h.open ? "checked" : ""}> Open</label>
            <input type="time" class="hours-open-time" value="${h.openTime}" ${h.open ? "" : "disabled"}>
            <span>–</span>
            <input type="time" class="hours-close-time" value="${h.closeTime}" ${h.open ? "" : "disabled"}>
        </div>
    `;
}).join("");

hoursRowsEl.querySelectorAll(".hours-row").forEach(row => {
    const checkbox = row.querySelector(".hours-open-check");
    const openTime = row.querySelector(".hours-open-time");
    const closeTime = row.querySelector(".hours-close-time");
    checkbox.addEventListener("change", () => {
        row.classList.toggle("is-closed", !checkbox.checked);
        openTime.disabled = closeTime.disabled = !checkbox.checked;
    });
});

document.querySelector('#wizard-step-2 [data-back]').addEventListener("click", () => goToStep(1));
document.querySelector('#wizard-step-2 [data-next]').addEventListener("click", () => {
    const breweryName = showingManualEntry
        ? manualNameInput.value.trim()
        : breweryQueryEl.value.trim();

    if (!breweryName) {
        HW.showAlert(alertEl, showingManualEntry ? "Please enter your brewery name." : "Please select your brewery or add it manually.");
        return;
    }
    if (!showingManualEntry && !state.existingBreweryId) {
        HW.showAlert(alertEl, "Please select your brewery from the list, or add it manually.");
        return;
    }

    const address = document.getElementById("breweryAddress").value.trim();
    if (!address) {
        HW.showAlert(alertEl, "Please enter your brewery address.");
        return;
    }

    // Validate hours: any open day needs a close time after the open time.
    for (const d of DAYS) {
        const row = hoursRowsEl.querySelector(`.hours-row[data-day="${d.key}"]`);
        const open = row.querySelector(".hours-open-check").checked;
        if (!open) continue;
        const openTime = row.querySelector(".hours-open-time").value;
        const closeTime = row.querySelector(".hours-close-time").value;
        if (!openTime || !closeTime || closeTime <= openTime) {
            HW.showAlert(alertEl, `${d.label}: closing time must be after opening time (or mark the day closed).`);
            return;
        }
    }

    state.breweryName = breweryName;
    state.isNewBrewery = showingManualEntry;
    state.address = address;
    state.phone = document.getElementById("breweryPhone").value.trim();
    state.websiteUrl = document.getElementById("websiteUrl").value.trim();
    state.facebookUrl = document.getElementById("facebookUrl").value.trim();
    state.instagramUrl = document.getElementById("instagramUrl").value.trim();
    state.beerMenuUrl = document.getElementById("beerMenuUrl").value.trim();
    state.foodType = document.querySelector('input[name="foodType"]:checked').value;
    state.foodMenuUrl = state.foodType === "kitchen" ? document.getElementById("foodMenuUrl").value.trim() : "";

    state.hours = {};
    DAYS.forEach(d => {
        const row = hoursRowsEl.querySelector(`.hours-row[data-day="${d.key}"]`);
        const open = row.querySelector(".hours-open-check").checked;
        state.hours[d.key] = {
            open,
            openTime: open ? row.querySelector(".hours-open-time").value : "00:00",
            closeTime: open ? row.querySelector(".hours-close-time").value : "00:00"
        };
    });

    saveState();
    renderTierList();
    goToStep(3);
});

// ── STEP 3: PLAN ─────────────────────────────────────────────────────────────
function renderTierList() {
    document.getElementById("tier-list").innerHTML = TIERS.map(t => `
        <label class="tier-card ${state.tierKey === t.key ? "selected" : ""}" data-tier="${t.key}">
            <span>
                <input type="radio" name="tier" value="${t.key}" ${state.tierKey === t.key ? "checked" : ""}>
                ${t.label}
            </span>
            <span class="tier-price">$${t.price}/mo</span>
        </label>
    `).join("");

    document.querySelectorAll('#tier-list .tier-card').forEach(card => {
        card.addEventListener("click", () => {
            document.querySelectorAll('#tier-list .tier-card').forEach(c => c.classList.remove("selected"));
            card.classList.add("selected");
            card.querySelector('input[type="radio"]').checked = true;
        });
    });
}
renderTierList();

document.querySelector('#wizard-step-3 [data-back]').addEventListener("click", () => goToStep(2));
document.querySelector('#wizard-step-3 [data-next]').addEventListener("click", () => {
    const checked = document.querySelector('#tier-list input[name="tier"]:checked');
    if (!checked) {
        HW.showAlert(alertEl, "Please select how many locations you have.");
        return;
    }
    const tier = TIERS.find(t => t.key === checked.value);
    state.tierKey = tier.key;
    state.tierLabel = tier.label;
    state.monthlyPrice = tier.price;
    state.maxLocations = tier.maxLocations;
    saveState();

    document.getElementById("summary-brewery").textContent = state.breweryName;
    document.getElementById("summary-plan").textContent = tier.label;
    document.getElementById("summary-price").textContent = `$${tier.price}/month`;
    document.getElementById("summary-due-note").textContent =
        `First 3 months free. Your card won't be charged until ${formatFirstChargeDate()}, then $${tier.price}/month after that.`;

    goToStep(4);
});

// ── STEP 4: REVIEW & SUBSCRIBE ───────────────────────────────────────────────
document.querySelector('#wizard-step-4 [data-back]').addEventListener("click", () => goToStep(3));

document.getElementById("checkout-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Redirecting to Stripe…";
    HW.hideAlert(alertEl);

    try {
        saveState();
        const res = await fetch(`${HW.API_BASE}/api/stripe/create-checkout-session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: state.email,
                tier: state.tierKey,
                breweryName: state.breweryName,
                successUrl: `${location.origin}${location.pathname.replace(/signup\.html$/, "")}signup-complete.html?session_id={CHECKOUT_SESSION_ID}`,
                cancelUrl: `${location.origin}${location.pathname}?canceled=1`
            })
        });

        const body = await res.json().catch(() => null);
        if (!res.ok || !body || !body.checkoutUrl) {
            throw new Error((body && (body.error || body.detail)) || "Could not start checkout. Please try again.");
        }

        window.location.href = body.checkoutUrl;
    } catch (err) {
        HW.showAlert(alertEl, err.message);
        btn.disabled = false;
        btn.textContent = "Complete Subscription";
    }
});

// ── Resume where we left off (e.g. after canceling checkout) ────────────────
if (new URLSearchParams(location.search).get("canceled") === "1") {
    HW.showAlert(alertEl, "Checkout was canceled — you have not been charged. Pick up where you left off whenever you're ready.", "success");
}
