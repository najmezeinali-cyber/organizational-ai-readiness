import { randomUUID } from 'node:crypto';
import { db, transaction } from './db';
import { contentVersion, domains, questionsFor } from './content';
import { evaluate, validateAnswers } from './engine';
import { fail } from './auth';
import type { Answer, Assessment, Domain } from './types';

type Row = { id: string; domain: Domain; task: string; other_title: string; status: 'draft' | 'completed'; revision: number; answers: string; report: string | null; created_at: string; completed_at: string | null; content_version: string };
function project(row: Row): Assessment {
  return { id: row.id, domain: row.domain, task: row.task, otherTitle: row.other_title, status: row.status, revision: row.revision, answers: JSON.parse(row.answers), report: row.report ? JSON.parse(row.report) : null, createdAt: row.created_at, completedAt: row.completed_at, contentVersion: row.content_version };
}
export function ownedAssessment(id: string, owner: string) {
  const row = db().prepare('SELECT * FROM assessments WHERE id=? AND owner_id=?').get(id, owner) as Row | undefined;
  if (!row) fail(404, 'ارزیابی پیدا نشد.');
  return project(row);
}
export function listAssessments(owner: string) {
  return (db().prepare('SELECT * FROM assessments WHERE owner_id=? ORDER BY created_at DESC').all(owner) as Row[]).map(project);
}
export function createAssessment(owner: string, domain: Domain, task: string, otherTitle = '') {
  const domainInfo = domains.find((item) => item.id === domain);
  if (!domainInfo || (task !== 'other' && !domainInfo.tasks.some((item) => item.id === task))) fail(400, 'حوزه و کار انتخاب‌شده معتبر نیست.');
  if (otherTitle.length > 120) fail(400, 'عنوان کار باید حداکثر ۱۲۰ نویسه باشد.');
  return transaction(() => {
    if (db().prepare("SELECT id FROM assessments WHERE owner_id=? AND status='draft'").get(owner)) fail(409, 'یک ارزیابی ناتمام دارید؛ ابتدا آن را ادامه دهید یا حذف کنید.');
    const id = randomUUID();
    const now = new Date().toISOString();
    db().prepare('INSERT INTO assessments(id,owner_id,domain,task,other_title,content_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, owner, domain, task, task === 'other' ? otherTitle.trim() : '', contentVersion, now, now);
    return ownedAssessment(id, owner);
  });
}
export function saveAnswer(owner: string, id: string, revision: number, questionId: string, answer: Answer) {
  return transaction(() => {
    const assessment = ownedAssessment(id, owner);
    if (assessment.status !== 'draft') fail(409, 'این ارزیابی نهایی شده و قابل تغییر نیست.');
    if (assessment.contentVersion !== contentVersion) fail(409, 'نسخه سؤال‌ها تغییر کرده است. این پیش‌نویس را حذف و ارزیابی تازه‌ای شروع کنید.');
    if (assessment.revision !== revision) fail(409, 'پاسخ‌ها در صفحه دیگری تغییر کرده‌اند؛ پیش از ادامه صفحه را تازه کنید.');
    if (!questionsFor(assessment.domain).some((item) => item.id === questionId)) fail(400, 'سؤال متعلق به این ارزیابی نیست.');
    const answers = { ...assessment.answers, [questionId]: answer };
    try { validateAnswers(assessment.domain, answers); } catch { fail(400, 'گزینه پاسخ معتبر نیست.'); }
    db().prepare('UPDATE assessments SET answers=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?').run(JSON.stringify(answers), new Date().toISOString(), id, owner, revision);
    return ownedAssessment(id, owner);
  });
}
export function finalizeAssessment(owner: string, id: string, revision: number) {
  return transaction(() => {
    const assessment = ownedAssessment(id, owner);
    if (assessment.status !== 'draft' || assessment.revision !== revision) fail(409, 'وضعیت ارزیابی تغییر کرده است؛ صفحه را تازه کنید.');
    if (assessment.contentVersion !== contentVersion) fail(409, 'نسخه ارزیابی تغییر کرده است؛ یک ارزیابی تازه شروع کنید.');
    try { validateAnswers(assessment.domain, assessment.answers, true); } catch { fail(400, 'پیش از دریافت گزارش، به همه ۳۰ سؤال پاسخ بدهید.'); }
    const report = evaluate(assessment.domain, assessment.task, assessment.answers);
    const now = new Date().toISOString();
    db().prepare("UPDATE assessments SET status='completed',report=?,completed_at=?,updated_at=?,revision=revision+1 WHERE id=? AND owner_id=?").run(JSON.stringify(report), now, now, id, owner);
    return ownedAssessment(id, owner);
  });
}
