import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const questionnaire = await readFile(new URL('docs/questionnaire.fa.md', root), 'utf8');
const rules = await readFile(new URL('docs/assessment-rules.fa.md', root), 'utf8');
const headings = [...questionnaire.matchAll(/^### ([GDFHREPM]\d{2}) — .+$/gm)];
const questions = headings.map((match, index) => ({
  id: match[1],
  body: questionnaire.slice(match.index, headings[index + 1]?.index ?? questionnaire.length),
}));
const counts = { G: 5, D: 5, F: 5, H: 5, R: 4, E: 6, P: 6, M: 6 };
const expectedIds = Object.entries(counts).flatMap(([prefix, count]) =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(2, '0')}`),
);
assert.equal(questions.length, 42, 'The bank must contain 42 questions.');
assert.equal(new Set(questions.map(({ id }) => id)).size, 42, 'Question IDs must be unique.');
assert.deepEqual(questions.map(({ id }) => id).sort(), expectedIds.sort());

for (const { id, body } of questions) {
  assert.match(body, /\*\*سؤال:\*\*/, `${id}: missing question text`);
  assert.match(body, /\*\*مثال اختیاری:\*\*/, `${id}: missing optional example`);
  assert.match(body, /\*\*اثر:\*\*/, `${id}: missing outcome effect`);
  assert.deepEqual(
    [...body.matchAll(/^- ([۰۱۲۳]): /gm)].map((match) => match[1]),
    ['۰', '۱', '۲', '۳'],
    `${id}: exactly four ordered descriptive choices are required`,
  );
}
assert.match(questionnaire, /برای \*\*تمام ۴۲ سؤال بانک\*\* گزینه «نمی‌دانم/);

const sharedAxes = { G: 0, D: 1, F: 2, H: 3, R: 4 };
const specialtyAxes = [0, 1, 2, 3, 4, 4];
for (const specialty of ['E', 'P', 'M']) {
  const path = questions.filter(({ id }) => id[0] in sharedAxes || id[0] === specialty);
  assert.equal(path.length, 30, `${specialty}: each path must have 30 questions`);
  const axes = [0, 0, 0, 0, 0];
  for (const { id } of path) {
    const axis = id[0] in sharedAxes
      ? sharedAxes[id[0]]
      : specialtyAxes[Number(id.slice(1)) - 1];
    axes[axis] += 1;
  }
  assert.deepEqual(axes, [6, 6, 6, 6, 6], `${specialty}: each axis must have six questions`);
  console.log(`PASS ${specialty}: 30 questions; 6 per axis`);
}

const mapping = rules.split('### نگاشت همه سؤال‌ها به اقدام')[1]?.split('### اولویت‌بندی')[0];
assert.ok(mapping, 'The action mapping section must exist.');
const mappingRows = mapping.split('\n').filter((line) => /^\| A\d{2} \|/.test(line));
const mappedIds = [...mappingRows.join('\n').matchAll(/\b[GDFHREPM]\d{2}\b/g)].map((match) => match[0]);
assert.equal(mappedIds.length, 42, 'Every question must map to exactly one primary action.');
assert.deepEqual([...mappedIds].sort(), [...expectedIds].sort());
const mappedActions = [...mapping.matchAll(/^\| (A\d{2}) \|/gm)].map((match) => match[1]);
assert.deepEqual(mappedActions, Array.from({ length: 12 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`));
for (const { id, body } of questions) {
  const mappingRow = mapping.split('\n').find((line) => new RegExp(`\\b${id}\\b`).test(line));
  const action = mappingRow.match(/^\| (A\d{2}) \|/)[1];
  assert.ok(body.includes(action), `${id}: question effect and primary mapping must agree`);
}
console.log('PASS 42 unique questions: question text, four choices, optional example, and effect');
console.log('PASS unknown response documented for every question');
console.log('PASS 42 primary action mappings, consistent with individual question effects');
console.log('Content structure passed. This does not validate the assessment scientifically or execute its future scoring engine.');
