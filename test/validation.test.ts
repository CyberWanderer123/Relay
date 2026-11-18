import { describe, expect, it } from "vitest";
import { RelayError } from "../src/errors.js";
import { cleanText, normalizeForm, validateAnswers, type Field } from "../src/schema.js";
import { sampleForm } from "./helpers.js";

const fields = normalizeForm(sampleForm).fields;

describe("normalizeForm", () => {
  it("assigns ids when missing and keeps given ones", () => {
    const f = normalizeForm({ title: "T", fields: [{ type: "short_text", label: "A" }, { id: "q1", type: "email", label: "B" }] });
    expect(f.fields.map((x) => x.id)).toEqual(["q2", "q1"]);
  });

  const bad = (input: unknown) => {
    try {
      normalizeForm(input);
    } catch (e) {
      expect(e).toBeInstanceOf(RelayError);
      return (e as RelayError).details!.join("\n");
    }
    throw new Error("expected a validation error");
  };

  it("rejects more than 50 fields", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ type: "short_text", label: `Q${i}` }));
    expect(bad({ title: "T", fields: many })).toMatch(/fields/);
  });
  it("rejects labels over 300 characters", () => {
    expect(bad({ title: "T", fields: [{ type: "short_text", label: "x".repeat(301) }] })).toMatch(/label/);
  });
  it("rejects choice questions without enough options, and options on text fields", () => {
    expect(bad({ title: "T", fields: [{ type: "single_choice", label: "A", options: ["only"] }] })).toMatch(/at least 2/);
    expect(bad({ title: "T", fields: [{ type: "short_text", label: "A", options: ["a", "b"] }] })).toMatch(/only single_choice/);
  });
  it("rejects duplicate ids, duplicate options and semicolons in options", () => {
    expect(bad({ title: "T", fields: [{ id: "a", type: "email", label: "A" }, { id: "a", type: "email", label: "B" }] })).toMatch(/more than once/);
    expect(bad({ title: "T", fields: [{ type: "single_choice", label: "A", options: ["Yes", "yes"] }] })).toMatch(/twice/);
    expect(bad({ title: "T", fields: [{ type: "single_choice", label: "A", options: ["a;b", "c"] }] })).toMatch(/semicolon/);
  });
  it("rejects bad field ids", () => {
    expect(bad({ title: "T", fields: [{ id: "_hp", type: "email", label: "A" }] })).toMatch(/slugs/);
  });
});

describe("cleanText", () => {
  it("strips control and bidi characters", () => {
    const rlo = String.fromCharCode(0x202e);
    const bell = String.fromCharCode(7);
    expect(cleanText(`a${rlo}b${bell}c\n d`)).toBe("ab c d");
    expect(cleanText("line one\r\n\r\n\r\nline two", { multiline: true })).toBe("line one\n\nline two");
  });
});

describe("validateAnswers", () => {
  const ok = { q1: "Great", q3: "7" };

  it("accepts a valid minimal submission and coerces numbers", () => {
    const r = validateAnswers(fields, ok);
    expect(r).toEqual({ ok: true, answers: { q1: "Great", q3: 7 } });
  });
  it("requires required fields", () => {
    const r = validateAnswers(fields, { q3: "1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.q1).toMatch(/needs an answer/);
  });
  it("treats whitespace-only as missing", () => {
    const r = validateAnswers(fields, { q1: "   ", q3: "1" });
    expect(!r.ok && r.errors.q1).toBeTruthy();
  });
  it("rejects choice answers outside the options, matching case-insensitively", () => {
    expect(validateAnswers(fields, { ...ok, q1: "Amazing" }).ok).toBe(false);
    const r = validateAnswers(fields, { ...ok, q1: "great" });
    expect(r.ok && r.answers.q1).toBe("Great");
  });
  it("handles multi-choice: repeats, de-dupes, keeps option order, rejects unknowns", () => {
    const r = validateAnswers(fields, { ...ok, q2: ["Panel", "Intro", "intro"] });
    expect(r.ok && r.answers.q2).toEqual(["Intro", "Panel"]);
    expect(validateAnswers(fields, { ...ok, q2: ["Intro", "Nope"] }).ok).toBe(false);
  });
  it("rejects more than one value for single-value fields", () => {
    const r = validateAnswers(fields, { ...ok, q1: ["Great", "Okay"] });
    expect(!r.ok && r.errors.q1).toMatch(/one answer/);
  });
  it("parses numbers", () => {
    for (const good of ["0", "-3", "4.5", "1,000", " 12 ", "1e3"]) expect(validateAnswers(fields, { ...ok, q3: good }).ok).toBe(true);
    for (const badN of ["seven", "1.2.3", "Infinity", "0x10", "NaN"]) expect(validateAnswers(fields, { ...ok, q3: badN }).ok).toBe(false);
  });
  it("checks emails look like emails", () => {
    expect(validateAnswers(fields, { ...ok, q5: "ada@example.com" }).ok).toBe(true);
    for (const badE of ["ada", "ada@", "@x.com", "a b@x.com", "ada@example"]) {
      expect(validateAnswers(fields, { ...ok, q5: badE }).ok).toBe(false);
    }
  });
  it("rejects unknown field ids", () => {
    const r = validateAnswers(fields, { ...ok, q99: "x" });
    expect(!r.ok && r.errors._form).toMatch(/q99/);
  });
  it("caps answer length per field", () => {
    const longText = fields.find((f) => f.id === "q4") as Field;
    expect(longText.type).toBe("long_text");
    expect(validateAnswers(fields, { ...ok, q4: "x".repeat(5000) }).ok).toBe(true);
    expect(validateAnswers(fields, { ...ok, q4: "x".repeat(5001) }).ok).toBe(false);
  });
});
