// The pricing oracle for lesspane: an independent copy of the formula in lesspane/src/lib/pricing.ts and the
// numbers in lesspane/src/lib/config.ts (`pricing`). Price evals compare the assistant's answer with this.
//
// It is a copy on purpose: an eval that imported the app's own code would agree with any bug in it. When LessPane's
// prices change, update PRICING here; `npm run eval:lesspane` checks the oracle against the live landing page
// first and stops if they disagree.

export const PRICING = {
	perWindow: 7,
	storyFactor: { 1: 1.0, 2: 1.25, 3: 1.5 },
	serviceFactor: { exterior: 1.0, interior_exterior: 1.7 },
	addOns: { screens: 3, tracks: 4, hard_water: 10 }, // per window
	minimum: 120,
	roundTo: 5
};

/** max(minimum, round(windows × rate × story × service + Σ per-window add-ons), to the nearest roundTo). */
export function price({ windows, stories, service = 'exterior', addons = [] }, p = PRICING) {
	const base = windows * p.perWindow * p.storyFactor[stories] * p.serviceFactor[service];
	const extras = [...new Set(addons)].reduce((sum, a) => sum + windows * p.addOns[a], 0);
	const rounded = Math.round((base + extras) / p.roundTo) * p.roundTo;
	return Math.max(p.minimum, rounded);
}

/** The landing page's packages (lesspane/src/lib/layout.ts), outside only. */
export const PACKAGES = {
	Cottage: { windows: 12, stories: 1 },
	'Family home': { windows: 24, stories: 2 },
	'Large home': { windows: 60, stories: 3 }
};
