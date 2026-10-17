import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { actionLibrary, axes, contentVersion, domains, provenance, questionBank, questionsFor } from '../lib/content';
import { evaluate, validateAnswers } from '../lib/engine';
import type { Answer, Answers, Domain } from '../lib/types';

const fill = (domain: Domain, answer: Answer): Answers => Object.fromEntries(questionsFor(domain).map(q => [q.id, answer]));
const report = (overrides: Answers = {}, domain: Domain = 'engineering', task = 'delay-review') => evaluate(domain, task, { ...fill(domain, 3), ...overrides });
const ids = (items: { id: string }[]) => items.map(item => item.id);

test('static bank faithfully transcribes canonical questions/options/actions with source provenance', () => {
  const questionnaire = readFileSync(new URL('../docs/questionnaire.fa.md', import.meta.url), 'utf8');
  const rules = readFileSync(new URL('../docs/assessment-rules.fa.md', import.meta.url), 'utf8');
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  assert.equal(hash(questionnaire), provenance.questionnaireSha256);
  assert.equal(hash(rules), provenance.rulesSha256);
  assert.ok(contentVersion.includes(provenance.questionnaireSha256.slice(0, 16)));
  assert.ok(contentVersion.includes(provenance.rulesSha256.slice(0, 16)));
  assert.equal(hash(readFileSync(new URL('../lib/engine.ts', import.meta.url), 'utf8')), provenance.engineSha256);
  const normalizedContent = readFileSync(new URL('../lib/content.ts', import.meta.url), 'utf8')
    .replace(/"snapshotSha256": "[a-f0-9]+"/, '"snapshotSha256": "SNAPSHOT"')
    .replace(/export const contentVersion = '[^']+';/, "export const contentVersion = 'VERSION';");
  assert.equal(hash(normalizedContent), provenance.snapshotSha256, 'any content or engine change requires a new snapshot version');
  assert.ok(contentVersion.includes(provenance.snapshotSha256.slice(0, 16)));
  assert.equal(questionBank.length, 42);
  assert.equal(new Set(ids(questionBank)).size, 42);
  assert.equal(actionLibrary.length, 12);
  for (const q of questionBank) {
    assert.ok(questionnaire.includes(`**سؤال:** ${q.text}`), q.id);
    assert.equal(q.options.length, 4);
    for (const text of q.options) assert.ok(questionnaire.includes(text));
    assert.ok(actionLibrary.some(action => action.id === q.actionId));
    assert.ok(q.example);
  }
});

test('each domain has thirty ordered questions, six per axis, and the agreed task identifiers', () => {
  const expectedTasks = { engineering: ['delay-review', 'minutes', 'weekly-report', 'other'], procurement: ['purchase-tracking', 'comparison', 'minutes', 'other'], project: ['status-report', 'issues', 'minutes', 'other'] };
  for (const domain of domains) {
    const questions = questionsFor(domain.id);
    assert.equal(questions.length, 30);
    assert.equal(new Set(ids(questions)).size, 30);
    assert.deepEqual(ids(domain.tasks), expectedTasks[domain.id]);
    assert.deepEqual(questions.map(q => q.axis), axes.flatMap(axis => Array(6).fill(axis.id)));
    for (const axis of axes) assert.equal(questions.filter(q => q.axis === axis.id).length, 6);
    const sharedExample = questions.find(q => q.id === 'D04')!.example;
    assert.ok(!sharedExample.includes('؛'), 'explicitly labelled domain examples are split');
  }
  const copy = questionsFor('engineering');
  copy[0].options[0] = 'changed locally';
  assert.notEqual(questionsFor('engineering')[0].options[0], copy[0].options[0]);
});

for (const domain of ['engineering', 'procurement', 'project'] as const) {
  const task = domains.find(d => d.id === domain)!.tasks[0].id;
  test(`${domain}: all 3 reports self-declared prerequisites, no fake barriers, start actions`, () => {
    const result = evaluate(domain, task, fill(domain, 3));
    assert.ok(result.axes.every(axis => axis.score === 100 && axis.known === 6));
    assert.equal(result.gates.length, 0);
    assert.equal(result.blockers.length, 0);
    assert.deepEqual(ids(result.actions), ['A01', 'A02', 'A10']);
    assert.ok(result.actions.every(item => item.kind === 'start'));
    assert.equal(result.policyBlocked, false);
    assert.equal(result.version, contentVersion);
    assert.equal(result.weeks.length, 4);
    assert.equal(result.recommendations.filter(item => item.recommended).length, 1);
    assert.ok(result.recommendations.find(item => item.recommended)!.prerequisite.includes('خوداظهارشده'));
  });
  test(`${domain}: all 0 keeps policy, data and review before score-based advice`, () => {
    const result = evaluate(domain, task, fill(domain, 0));
    assert.ok(result.axes.every(axis => axis.score === 0 && axis.known === 6));
    assert.deepEqual(ids(result.actions), ['A09', 'A04', 'A06']);
    assert.equal(result.policyBlocked, true);
    assert.deepEqual(ids(result.gates), ['GATE-POLICY', 'GATE-DATA', 'GATE-SAMPLE', 'GATE-REVIEW', 'GATE-BOUNDARY', 'PREREQ-SCOPE', 'PREREQ-STOP']);
    assert.ok(result.prompt.includes('بدون ابزار عمومی'));
    assert.ok(result.recommendations.every(item => item.prerequisite.includes('فعلاً مجاز نیست')));
    assert.ok(result.weeks[1].body.includes('آماده‌سازی بدون ابزار عمومی'));
  });
  test(`${domain}: all unknown is complete but not numeric, personalized, or an allegation`, () => {
    const result = evaluate(domain, task, fill(domain, 'unknown'));
    assert.ok(result.axes.every(axis => axis.score === null && axis.known === 0));
    assert.equal(result.personalized, false);
    assert.deepEqual(ids(result.actions), ['A09', 'A04', 'A06']);
    assert.ok(result.actions.every(action => action.kind === 'clarification'));
    assert.ok(result.gates.every(gate => gate.title.includes('نیازمند روشن‌شدن')));
    assert.ok(result.recommendations.every(item => item.rank === 0 && !item.recommended));
  });
}

test('coverage 3 versus 4 uses only numeric answers, and raw score controls threshold classification', () => {
  const goal = questionsFor('engineering').filter(q => q.axis === 'goal');
  const answers = fill('engineering', 3);
  goal.forEach(q => { answers[q.id] = 'unknown'; });
  goal.slice(0, 3).forEach(q => { answers[q.id] = 3; });
  let axis = evaluate('engineering', 'delay-review', answers).axes[0];
  assert.equal(axis.known, 3); assert.equal(axis.score, null);
  answers[goal[3].id] = 3;
  axis = evaluate('engineering', 'delay-review', answers).axes[0];
  assert.equal(axis.known, 4); assert.equal(axis.score, 100);
  const cases: [Answer[], number, string][] = [
    [[1, 1, 1, 1, 2, 'unknown'], 40, 'بخشی از مقدمات فراهم است'],
    [[1, 1, 1, 1, 1, 2], 39, 'نیاز به آماده‌سازی بیشتر'],
    [[2, 2, 2, 2, 2, 2], 67, 'بخشی از مقدمات فراهم است'],
    [[2, 2, 2, 2, 2, 3], 72, 'مقدمات بیشتری گزارش شده است'],
  ];
  for (const [values, score, level] of cases) {
    goal.forEach((q, index) => { answers[q.id] = values[index]; });
    axis = evaluate('engineering', 'delay-review', answers).axes[0];
    assert.equal(axis.score, score); assert.equal(axis.level, level);
  }
});

test('all safety threshold combinations remain independent of high averages', () => {
  for (const value of [0, 1, 2, 3, 'unknown'] as Answer[]) {
    assert.equal(report({ D04: value }).gates.some(g => g.id === 'GATE-DATA'), value !== 3);
    assert.equal(report({ R03: value }).gates.some(g => g.id === 'GATE-DATA'), [0, 1, 'unknown'].includes(value));
    assert.equal(report({ D05: value }).gates.some(g => g.id === 'GATE-SAMPLE'), [0, 1, 'unknown'].includes(value));
    assert.equal(report({ R01: value }).policyBlocked, [0, 1, 'unknown'].includes(value));
    assert.equal(report({ R02: value }).policyBlocked, value !== 3);
    for (const id of ['F03', 'H03', 'E04']) assert.equal(report({ [id]: value }).gates.some(g => g.id === 'GATE-REVIEW'), [0, 1, 'unknown'].includes(value));
    for (const id of ['E05', 'E06']) assert.equal(report({ [id]: value }).gates.some(g => g.id === 'GATE-BOUNDARY'), [0, 1, 'unknown'].includes(value));
  }
  const denied = report({ R03: 0 });
  assert.ok(denied.axes.every(axis => axis.score! >= 83));
  assert.ok(denied.gates.find(g => g.id === 'GATE-DATA')!.detail.includes('ورود داده واقعی توصیه نمی‌شود'));
  assert.ok(report({ R03: 2 }).recommendations.every(r => r.prerequisite.includes('فقط در دامنه صریح مجوز')));
  const prohibited = report({ R02: 0, D05: 3 });
  assert.ok(prohibited.gates[0].detail.includes('داده ساختگی'));
  assert.ok(prohibited.prompt.includes('دورزدن سیاست شرکت نیست'));
  const unknownReviewer = report({ F03: 'unknown' });
  assert.ok(unknownReviewer.gates.find(g => g.id === 'GATE-REVIEW')!.detail.includes('اثبات نبود بازبین نیست'));
});

test('G05 and F05 add practical prerequisites after main gates and map to A01/A06', () => {
  for (const answer of [0, 1, 'unknown'] as Answer[]) {
    const result = report({ G05: answer, F05: answer });
    assert.deepEqual(ids(result.gates), ['PREREQ-SCOPE', 'PREREQ-STOP']);
    assert.deepEqual(result.gates.map(g => g.actionId), ['A01', 'A06']);
    assert.ok(result.recommendations.every(r => r.prerequisite.includes('بعد از') || r.prerequisite.includes('پس از رفع')));
  }
  assert.equal(report({ G05: 2, F05: 2 }).gates.length, 0);
});

test('event ordering uses priority, severity then path order; action evidence is merged and no barriers invented', () => {
  assert.deepEqual(ids(report({ G01: 1, D01: 0 }).blockers), ['A03', 'A01']);
  assert.deepEqual(ids(report({ G01: 0, D01: 0 }).blockers), ['A01', 'A03']);
  assert.deepEqual(ids(report({ G01: 'unknown', D01: 1 }).blockers), ['A03', 'A01']);
  const merged = report({ R01: 0, R02: 1, D04: 0, D05: 0, R03: 'unknown', F03: 0, E05: 0, E06: 'unknown' });
  assert.deepEqual(ids(merged.actions), ['A09', 'A04', 'A06']);
  assert.equal(new Set(ids(merged.actions)).size, 3);
  assert.equal(merged.actions[0].evidence.length, 2);
  assert.equal(merged.actions[1].evidence.length, 3);
  assert.ok(merged.gates.some(g => g.actionId === 'A12'));
  const single = report({ H02: 0 });
  assert.equal(single.blockers.length, 1);
  assert.deepEqual(ids(single.actions), ['A08', 'A01', 'A02']);
  assert.equal(report({ G03: 2 }).actions[0].kind, 'improve');
  assert.equal(report({ G03: 2 }).actions[0].id, 'A02');
  assert.equal(report({ G04: 'unknown' }).blockers[0].kind, 'clarification');
});

test('comparison is never recommended with unknown/low P02 even when selected', () => {
  for (const P02 of [0, 1, 'unknown'] as Answer[]) {
    const result = report({ P02 }, 'procurement', 'comparison');
    assert.equal(result.recommendations.find(r => r.id === 'comparison')!.recommended, false);
    assert.ok(result.recommendations.find(r => r.id === 'comparison')!.prerequisite.includes('نیازمند آماده‌سازی ورودی'));
    assert.equal(result.recommendations.find(r => r.recommended)!.id, 'purchase-tracking');
  }
  const result = report({}, 'procurement', 'comparison');
  assert.equal(result.recommendations.find(r => r.recommended)!.id, 'comparison');
});

test('ranking is transparent, repeated output deterministic, and defaults break genuine ties', () => {
  const answers = fill('engineering', 3);
  assert.deepEqual(evaluate('engineering', 'minutes', answers), evaluate('engineering', 'minutes', { ...answers }));
  const result = evaluate('engineering', 'minutes', answers);
  assert.deepEqual(ids(result.recommendations), ['delay-review', 'weekly-report', 'minutes']);
  assert.deepEqual(result.recommendations.map(r => r.rank), [6, 6, 5]);
  assert.ok(result.recommendations[0].reason.includes('D01 و D02'));
  assert.ok(result.recommendations.find(r => r.id === 'minutes')!.prerequisite.includes('وجود یادداشت مجاز'));
  const sparse = fill('engineering', 'unknown');
  const relevant = ['G01', 'G02', 'G05', 'D01', 'D02', 'F01'];
  relevant.slice(0, 5).forEach(id => { sparse[id] = 2; });
  assert.equal(evaluate('engineering', 'delay-review', sparse).personalized, false);
  sparse.F01 = 2;
  assert.equal(evaluate('engineering', 'delay-review', sparse).personalized, true);
});

test('other yields three standalone generic templates, never analysis of a free-text title', () => {
  for (const domain of domains) {
    const result = evaluate(domain.id, 'other', fill(domain.id, 3));
    assert.deepEqual(ids(result.recommendations), ['organize', 'draft', 'extract-actions']);
    assert.ok(result.recommendations.every(r => r.description.includes('قالب عمومی، نه راهکار اختصاصی تحلیل‌شده')));
    assert.ok(result.prompt.includes('قالب عمومی، نه راهکار اختصاصی تحلیل‌شده'));
    assert.ok(result.expectedOutput.includes('نامعلوم'));
    assert.ok(result.sampleInput.includes('ساختگی'));
    assert.ok(result.worksheet.length >= 8);
    assert.equal(result.personalized, true);
  }
});

test('every task supplies safe complete sample, expected output, controls and measured worksheet', () => {
  for (const domain of domains) for (const task of domain.tasks) {
    const result = evaluate(domain.id, task.id, fill(domain.id, 3));
    assert.ok(result.sampleInput.includes('ساختگی'));
    assert.ok(result.prompt.includes('ناموجود نساز'));
    assert.ok(result.expectedOutput.length > 100);
    const sheet = result.worksheet.join(' ');
    for (const field of ['تاریخ', 'حجم و پیچیدگی', 'زمان جمع‌آوری', 'زمان آماده‌سازی', 'زمان استفاده از ابزار', 'زمان بازبینی/اصلاح', 'زمان کل', 'خطاهای مهم', 'صحت نسبت به منبع', 'کامل‌بودن', 'قابلیت پیگیری', 'قابل سنجش نبود', 'استفاده یا رد', 'صفر/نامعلوم', 'مقدار منفی', 'ادامه / اصلاح / توقف']) assert.ok(sheet.includes(field), `${domain.id}/${task.id}: ${field}`);
  }
});

test('report is a frozen self-contained snapshot, not a live reference to answers or content', () => {
  const answers = fill('engineering', 3);
  const result = evaluate('engineering', 'delay-review', answers);
  answers.G01 = 0;
  assert.equal(result.answers.G01, 3);
  assert.notEqual(result.answers, answers);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.answers));
  assert.ok(Object.isFrozen(result.actions[0]));
  assert.ok(Object.isFrozen(result.recommendations));
  assert.ok(!('name' in result) && !('email' in result) && !('user' in result));
  const original = axes[0].label;
  try {
    axes[0].label = 'future label';
    assert.equal(result.axes[0].label, original);
  } finally { axes[0].label = original; }
});

test('validation permits partial drafts and explicit unknown but rejects missing, invalid, cross-domain and prototype data', () => {
  assert.doesNotThrow(() => validateAnswers('engineering', {}));
  assert.doesNotThrow(() => validateAnswers('engineering', { G01: 'unknown' }));
  assert.doesNotThrow(() => validateAnswers('engineering', fill('engineering', 'unknown'), true));
  assert.throws(() => validateAnswers('engineering', {}, true));
  assert.throws(() => evaluate('engineering', 'delay-review', {}));
  const missing = fill('engineering', 3); delete missing.G01;
  assert.throws(() => evaluate('engineering', 'delay-review', missing));
  for (const invalid of [null, undefined, [], '3', 3, true, { G01: '3' }, { G01: -1 }, { G01: 4 }, { G01: NaN }, { G01: 1.5 }, { G01: null }, { G01: undefined }, { E99: 3 }, { P01: 3 }, { G01: false }]) {
    assert.throws(() => validateAnswers('engineering', invalid as unknown as Answers));
  }
  assert.throws(() => questionsFor('unknown' as Domain));
  assert.throws(() => questionsFor('toString' as Domain));
  assert.throws(() => evaluate('engineering', 'comparison', fill('engineering', 3)));
  assert.throws(() => evaluate('engineering', 'free text title', fill('engineering', 3)));
  assert.throws(() => validateAnswers('engineering', Object.create({ G01: 3 })));
  assert.throws(() => validateAnswers('engineering', Object.defineProperty({}, 'G01', { value: 3, enumerable: false }) as Answers));
  assert.throws(() => validateAnswers('engineering', { get G01() { throw new Error('must not invoke accessor'); } } as unknown as Answers));
  const symbol = { [Symbol('answer')]: 3 };
  assert.throws(() => validateAnswers('engineering', symbol as Answers));
});
