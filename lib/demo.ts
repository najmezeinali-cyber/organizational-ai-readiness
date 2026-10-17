import { questionsFor } from './content';
import { evaluate } from './engine';
import type { Answers } from './types';

// Entirely fictional; never treated as a completed user assessment.
export function demoReport() {
  const answers: Answers = Object.fromEntries(questionsFor('engineering').map((question) => [question.id, 2]));
  Object.assign(answers, { G02: 3, G03: 0, G04: 1, D01: 2, D02: 3, D04: 1, D05: 1, E02: 1, F01: 2, F03: 2, H02: 1, R01: 2, R02: 1, R03: 0, R04: 1, E05: 2, E06: 2 });
  return evaluate('engineering', 'delay-review', answers);
}
