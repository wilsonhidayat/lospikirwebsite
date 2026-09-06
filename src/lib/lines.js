/**
 * Split a CMS text value into display lines.
 *
 * Headlines and card titles are set in the CMS as ordinary text with a line
 * break where the type should wrap. Components render one <MaskLine> (or one
 * block) per returned entry. Blank lines are dropped so a stray newline in the
 * editor can't open a gap.
 */
export function lines(value) {
  return String(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}
