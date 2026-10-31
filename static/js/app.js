document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("tripForm");
  if (!form) return;

  const profileOptions = {
    Female: ["Skincare", "Makeup", "Hair care", "Sanitary essentials", "Jewelry", "Hair accessories", "Handbag", "Scarf / Stole"],
    Male: ["Shaving kit", "Beard care", "Skincare", "Hair care", "Belt", "Wallet", "Watch", "Cap"],
    Other: []
  };
  const panel = document.getElementById("personalizationPanel");
  const tripTypeGroup = document.getElementById("tripTypeGroup");
  const activities = document.getElementById("activitiesSection");
  const hostel = document.getElementById("hostelSection");
  const childAgeGroup = document.getElementById("childAgeGroup");
  const children = document.getElementById("children");
  const button = document.getElementById("generatePackingBtn");

  const selected = name => form.querySelector(`input[name="${name}"]:checked`)?.value;
  const clearChecked = name => form.querySelectorAll(`input[name="${name}"]`).forEach(input => input.checked = false);

  function configureSelectAll(control) {
    const name = control.dataset.selectAll;
    const options = () => [...form.querySelectorAll(`input[name="${name}"]`)];
    const sync = () => {
      const inputs = options();
      const count = inputs.filter(input => input.checked).length;
      control.checked = inputs.length > 0 && count === inputs.length;
      control.indeterminate = count > 0 && count < inputs.length;
    };
    control.addEventListener("change", () => { options().forEach(input => input.checked = control.checked); control.indeterminate = false; });
    options().forEach(input => input.addEventListener("change", sync));
    sync();
  }

  function initializeSelectAll(container = form) {
    container.querySelectorAll("[data-select-all]").forEach(configureSelectAll);
  }

  function updatePersonalizationOptions() {
    const profile = selected("profile");
    const choices = profileOptions[profile];
    if (!profile || choices === undefined) { panel.hidden = true; panel.innerHTML = ""; return; }
    if (!choices.length) {
      panel.innerHTML = "<h3>Your essentials stay complete</h3><p>Clothing, toiletries, medicines, documents, electronics and footwear stay part of your list. Add any personal items you want later.</p>";
      panel.hidden = false;
      return;
    }
    const retained = new Set([...panel.querySelectorAll('input:checked')].map(input => input.value));
    panel.innerHTML = `<div class="personalization-header"><div><h3>Optional preferences</h3><p>Select only what you would like to bring.</p></div><label class="select-all"><input type="checkbox" data-select-all="personalization"><span>Select all</span></label></div><div class="choice-grid">${choices.map(choice => `<label class="choice"><input type="checkbox" name="personalization" value="${choice}" ${retained.has(choice) ? "checked" : ""}><span>${choice}</span></label>`).join("")}</div>`;
    panel.hidden = false;
    initializeSelectAll(panel);
  }

  function updateTravelMode() {
    const isHostel = selected("travel_mode") === "Hostel";
    tripTypeGroup.hidden = isHostel;
    activities.hidden = isHostel;
    hostel.hidden = !isHostel;
    if (isHostel) clearChecked("trip_type");
  }

  function updateChildren() {
    const hasChildren = selected("has_children") === "yes";
    childAgeGroup.hidden = !hasChildren;
    if (!hasChildren) { children.value = "0"; document.getElementById("child_age").value = ""; }
    else if (Number(children.value) < 1) children.value = "1";
  }

  function setError(selector, message) {
    const element = document.querySelector(selector);
    if (element) element.textContent = message;
  }

  function validateTripForm() {
    let valid = true;
    form.querySelectorAll(".field-error").forEach(error => error.textContent = "");
    form.querySelectorAll("[aria-invalid]").forEach(input => input.removeAttribute("aria-invalid"));
    ["destination", "start_date", "end_date"].forEach(id => {
      const input = document.getElementById(id);
      if (!input.value) { input.setAttribute("aria-invalid", "true"); input.closest(".form-group").querySelector(".field-error").textContent = `Please provide ${input.labels[0].textContent.replace("*", "").trim().toLowerCase()}.`; valid = false; }
    });
    if (!selected("travel_mode")) { setError(".mode-error", "Please choose a travel mode."); valid = false; }
    if (selected("travel_mode") !== "Hostel" && !selected("trip_type")) { setError(".trip-type-error", "Please choose a trip type."); valid = false; }
    if (!selected("profile")) { setError(".profile-error", "Please choose a packing profile."); valid = false; }
    const start = document.getElementById("start_date").value;
    const end = document.getElementById("end_date").value;
    if (start && end && end < start) { document.getElementById("end_date").setAttribute("aria-invalid", "true"); document.getElementById("end_date").closest(".form-group").querySelector(".field-error").textContent = "Return must be on or after departure."; valid = false; }
    return valid;
  }

  form.querySelectorAll('input[name="profile"]').forEach(input => input.addEventListener("change", updatePersonalizationOptions));
  form.querySelectorAll('input[name="travel_mode"]').forEach(input => input.addEventListener("change", updateTravelMode));
  form.querySelectorAll('input[name="has_children"]').forEach(input => input.addEventListener("change", updateChildren));
  form.addEventListener("submit", event => {
    if (!validateTripForm()) { event.preventDefault(); document.querySelector('[aria-invalid="true"]')?.focus(); return; }
    button.disabled = true;
    button.textContent = "Checking destination weather…";
    setTimeout(() => {
      if (button.disabled) {
        button.textContent = "Preparing your weather-based packing list…";
      }
    }, 1200);
  });
  initializeSelectAll(); updatePersonalizationOptions(); updateTravelMode(); updateChildren();
});
