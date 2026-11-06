'use strict';

// What kind of message the tower just sent, read from its text.
// The tower engine sends plain text; these patterns follow its wording
// (standard phraseology for one traffic circuit).

const KINDS = {
  negative: 'Negative',
  readback: 'Read back request',
  change: 'Change of plan',
  clearance: 'Clearance',
  instruction: 'Instruction',
  information: 'Information',
  traffic: 'Other aircraft',
};

const PATTERNS = [
  ['negative', /\bnegative\b/i],
  ['readback', /\bread back\b/i],
  ['change', /\b(number (2|two)|follow the|extend downwind|orbit (left|right)|unable to approve|make full stop|report final)\b/i],
  ['clearance', /\b(cleared|line up and wait|taxi (holding point|to))\b/i],
  ['instruction', /\b(contact (tower|ground)|squawk|vacate)\b/i],
];

/**
 * @param {{speaker?: string, text: string, toPilot?: boolean}} t
 * @returns {{kind: string, label: string, load: number}}
 *   load: how many items the message packs (comma-separated parts, minus the
 *   callsign), a rough measure of how much there is to read back.
 */
function classify(t) {
  const text = String((t && t.text) || '');
  const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
  const load = Math.max(0, parts.length - 1);
  if (t && (t.toPilot === false || t.speaker === 'traffic')) {
    return { kind: 'traffic', label: KINDS.traffic, load };
  }
  for (const [kind, re] of PATTERNS) {
    if (re.test(text)) return { kind, label: KINDS[kind], load };
  }
  return { kind: 'information', label: KINDS.information, load };
}

module.exports = { classify, KINDS };
