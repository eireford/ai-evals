// Price tests for the lesspane assistant, generated from the pricing oracle so no expected price is typed by hand.
// Each job is asked several ways (metamorphic testing): the wording changes, the price must not.

import { price } from '../fixtures/lesspane-pricing.mjs';

const usd = (n) => `$${n.toLocaleString('en-US')}`;
/** Matches the price as a whole amount: "$210" but not "$2100" or "$21". */
const priceRegex = (n) => `\\$${n.toLocaleString('en-US').replace(',', ',?')}(?![\\d,])`;

const JOBS = [
	{
		job: { windows: 24, stories: 2 },
		asks: [
			'How much for 24 windows on a two-story house, outside only?',
			'Two floors, two dozen windows, just the outsides. Price?',
			'what would u charge for 24 windows (2 story house) exterior'
		]
	},
	{
		job: { windows: 18, stories: 2, service: 'interior_exterior' },
		asks: ['How much to clean 18 windows on a two-story house, inside and out?']
	},
	{
		job: { windows: 8, stories: 1 },
		asks: ['How much for 8 windows on a one story house, outside only?'],
		note: 'the minimum applies'
	},
	{
		job: { windows: 30, stories: 1, addons: ['screens'] },
		asks: ['Price for 30 windows, single story, outside only, plus screen cleaning?']
	},
	{
		job: { windows: 40, stories: 3, addons: ['hard_water'] },
		asks: ['We have a three-story house with 40 windows and hard water spots on all of them. Outside only. How much?']
	}
];

export default JOBS.flatMap(({ job, asks, note }) => {
	const expected = price(job);
	return asks.map((question, i) => ({
		description: `price ${usd(expected)}: ${job.windows} windows, ${job.stories}-story, ${job.service ?? 'exterior'}${job.addons ? ' + ' + job.addons.join(', ') : ''}${note ? ` (${note})` : ''}${i ? ` [paraphrase ${i}]` : ''}`,
		vars: { question },
		metadata: { category: 'price', critical: true, expected, ...(i ? { metamorphicOf: `price-${expected}` } : {}) },
		assert: [{ type: 'regex', value: priceRegex(expected), metric: 'price-matches-oracle' }]
	}));
});
