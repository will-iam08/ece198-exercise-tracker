import { describe, expect, it } from 'vitest';
import { assignmentMaps, isAssigned, parseDoctorForm } from './admin.js';
import { parseQuestion, parseReply, sourceLabel, unreadText } from './messages.js';
import { isSameHostOrigin, parseHostList } from './origin.js';

describe('admin overview lookups', () => {
  const overview = {
    patients: [{ id: 'p1', name: 'Pat' }, { id: 'p2', name: 'Quinn' }],
    doctors: [{ id: 'd1', name: 'Dr A' }, { id: 'd2', name: 'Dr B' }],
    assignments: [{ staff_id: 'd1', participant_id: 'p1' }, { staff_id: 'd2', participant_id: 'p1' }, { staff_id: 'gone', participant_id: 'p2' }],
  };
  it('groups assignments both ways and skips unknown ids', () => {
    const { patientsByDoctor, doctorsByPatient } = assignmentMaps(overview);
    expect(patientsByDoctor.get('d1').map(p => p.id)).toEqual(['p1']);
    expect(patientsByDoctor.get('d2').map(p => p.id)).toEqual(['p1']);
    expect(doctorsByPatient.get('p1').map(d => d.id)).toEqual(['d1', 'd2']);
    expect(doctorsByPatient.get('p2')).toEqual([]);
    expect(isAssigned(overview, 'd1', 'p1')).toBe(true);
    expect(isAssigned(overview, 'd1', 'p2')).toBe(false);
    expect(assignmentMaps(null).patientsByDoctor.size).toBe(0);
  });
  it('validates the new doctor form', () => {
    expect(parseDoctorForm({ name: ' Dr New ', email: ' new@example.com ', password: 'long-enough-pass' }))
      .toEqual({ body: { name: 'Dr New', email: 'new@example.com', password: 'long-enough-pass' } });
    expect(parseDoctorForm({ name: '', email: 'a@b.co', password: 'long-enough-pass' }).error).toMatch(/name/);
    expect(parseDoctorForm({ name: 'A', email: 'nope', password: 'long-enough-pass' }).error).toMatch(/email/);
    expect(parseDoctorForm({ name: 'A', email: 'a@b.co', password: 'short' }).error).toMatch(/12 to 128/);
  });
});

describe('messages', () => {
  it('validates questions and replies', () => {
    expect(parseQuestion({ subject: ' Reps ', body: ' Can I do more? ' })).toEqual({ body: { subject: 'Reps', body: 'Can I do more?' } });
    expect(parseQuestion({ body: 'Hi' })).toEqual({ body: { body: 'Hi' } });
    expect(parseQuestion({ body: '   ' }).error).toMatch(/Write your question/);
    expect(parseQuestion({ body: 'x'.repeat(4001) }).error).toMatch(/4000/);
    expect(parseQuestion({ subject: 'x'.repeat(201), body: 'Hi' }).error).toMatch(/200/);
    expect(parseReply(' Yes ')).toEqual({ reply: 'Yes' });
    expect(parseReply('').error).toMatch(/Write a reply/);
  });
  it('labels sources and counts', () => {
    expect(sourceLabel('email_bot')).toBe('By email');
    expect(sourceLabel('portal')).toBe('From the website');
    expect(unreadText(0)).toBe('No unread messages');
    expect(unreadText(1)).toBe('1 unread message');
    expect(unreadText(3)).toBe('3 unread messages');
  });
});

describe('dev-server origin handling', () => {
  it('recognises same-host origins only', () => {
    expect(isSameHostOrigin('http://192.168.1.20:5173', '192.168.1.20:5173')).toBe(true);
    expect(isSameHostOrigin('https://demo.example.org', 'demo.example.org')).toBe(true);
    expect(isSameHostOrigin('https://evil.example', 'demo.example.org')).toBe(false);
    expect(isSameHostOrigin('http://192.168.1.20:5174', '192.168.1.20:5173')).toBe(false);
    expect(isSameHostOrigin('not a url', 'demo.example.org')).toBe(false);
    expect(isSameHostOrigin(undefined, 'demo.example.org')).toBe(false);
  });
  it('splits host lists', () => {
    expect(parseHostList(' a.example.org, .trycloudflare.com ,,')).toEqual(['a.example.org', '.trycloudflare.com']);
    expect(parseHostList(undefined)).toEqual([]);
  });
});
