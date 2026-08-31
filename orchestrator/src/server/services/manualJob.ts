/**
 * Service for inferring job details from a pasted job description.
 */

import { logger } from "@infra/logger";
import type { ManualJobDraft } from "@shared/types";
import { stripHtmlTags } from "@shared/utils/string";
import type { JsonSchemaDefinition } from "./llm/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";

export interface ManualJobInferenceResult {
  job: ManualJobDraft;
  warning?: string | null;
}

/** Raw response type from the API. Providers may violate the JSON schema. */
interface ManualJobApiResponse {
  title?: unknown;
  employer?: unknown;
  location?: unknown;
  salary?: unknown;
  deadline?: unknown;
  jobUrl?: unknown;
  applicationLink?: unknown;
  jobType?: unknown;
  jobLevel?: unknown;
  jobFunction?: unknown;
  disciplines?: unknown;
  degreeRequired?: unknown;
  starting?: unknown;
  jobDescription?: unknown;
}

/** JSON schema for manual job extraction response */
const MANUAL_JOB_SCHEMA: JsonSchemaDefinition = {
  name: "manual_job_details",
  schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Job title" },
      employer: { type: "string", description: "Company/employer name" },
      location: { type: "string", description: "Job location" },
      salary: { type: "string", description: "Salary information" },
      deadline: { type: "string", description: "Application deadline" },
      jobUrl: { type: "string", description: "URL of the job listing" },
      applicationLink: {
        type: "string",
        description: "Direct application URL",
      },
      jobType: {
        type: "string",
        description: "Employment type (full-time, part-time, etc.)",
      },
      jobLevel: {
        type: "string",
        description: "Seniority level (entry, mid, senior, etc.)",
      },
      jobFunction: { type: "string", description: "Job function/category" },
      disciplines: {
        type: "string",
        description: "Required disciplines or fields",
      },
      degreeRequired: {
        type: "string",
        description: "Required degree or education",
      },
      starting: { type: "string", description: "Start date information" },
      jobDescription: {
        type: "string",
        description:
          "Clean text job description with responsibilities and requirements",
      },
    },
    required: [
      "title",
      "employer",
      "location",
      "salary",
      "deadline",
      "jobUrl",
      "applicationLink",
      "jobType",
      "jobLevel",
      "jobFunction",
      "disciplines",
      "degreeRequired",
      "starting",
      "jobDescription",
    ],
    additionalProperties: false,
  },
};

export async function inferManualJobDetails(
  jobDescription: string,
): Promise<ManualJobInferenceResult> {
  const model = await resolveLlmModel();
  const prompt = buildInferencePrompt(stripHtmlTags(jobDescription));

  const llm = await createConfiguredLlmService();
  const result = await llm.callJson<ManualJobApiResponse>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: MANUAL_JOB_SCHEMA,
  });

  if (!result.success) {
    if (result.error.toLowerCase().includes("api key")) {
      return {
        job: {},
        warning: "LLM API key not set. Fill details manually.",
      };
    }
    logger.warn("Manual job inference failed", { error: result.error });
    return {
      job: {},
      warning: "AI inference failed. Fill details manually.",
    };
  }

  return { job: normalizeDraft(result.data) };
}

function buildInferencePrompt(jd: string): string {
  return `
You are extracting structured data from a job posting.
The input is plain text from a job listing page.
Return JSON only with the keys listed below. Use empty string if unknown.
Do not guess or invent data. Ignore navigation, headers, footers, and other non-job content.

Keys:
- title (job title)
- employer (company name)
- location (job location)
- salary (salary/compensation info)
- deadline (application deadline)
- jobUrl (the listing URL, if present in the content)
- applicationLink (the apply URL, if present)
- jobType (full-time, part-time, contract, etc.)
- jobLevel (entry, mid, senior, etc.)
- jobFunction (engineering, marketing, etc.)
- disciplines (required fields/disciplines)
- degreeRequired (required education)
- starting (start date)
- jobDescription (clean plain text of the job description including responsibilities and requirements - extract this from the HTML/content)

JOB POSTING CONTENT:
${jd}

OUTPUT FORMAT (JSON ONLY):
{
  "title": "",
  "employer": "",
  "location": "",
  "salary": "",
  "deadline": "",
  "jobUrl": "",
  "applicationLink": "",
  "jobType": "",
  "jobLevel": "",
  "jobFunction": "",
  "disciplines": "",
  "degreeRequired": "",
  "starting": "",
  "jobDescription": ""
}
`.trim();
}

function normalizeText(value: unknown): string | undefined {
  const values = Array.isArray(value) ? value : [value];
  const normalized = values
    .filter(
      (entry): entry is string | number =>
        typeof entry === "string" || typeof entry === "number",
    )
    .map((entry) => String(entry).trim())
    .filter(Boolean)
    .join(", ");
  return normalized || undefined;
}

export function normalizeDraft(
  parsed: ManualJobApiResponse,
): ManualJobDraft {
  const out: ManualJobDraft = {};

  // Providers occasionally return arrays despite the string-only schema.
  const title = normalizeText(parsed.title);
  const employer = normalizeText(parsed.employer);
  const location = normalizeText(parsed.location);
  const salary = normalizeText(parsed.salary);
  const deadline = normalizeText(parsed.deadline);
  const jobUrl = normalizeText(parsed.jobUrl);
  const applicationLink = normalizeText(parsed.applicationLink);
  const jobType = normalizeText(parsed.jobType);
  const jobLevel = normalizeText(parsed.jobLevel);
  const jobFunction = normalizeText(parsed.jobFunction);
  const disciplines = normalizeText(parsed.disciplines);
  const degreeRequired = normalizeText(parsed.degreeRequired);
  const starting = normalizeText(parsed.starting);
  const jobDescription = normalizeText(parsed.jobDescription);

  if (title) out.title = title;
  if (employer) out.employer = employer;
  if (location) out.location = location;
  if (salary) out.salary = salary;
  if (deadline) out.deadline = deadline;
  if (jobUrl) out.jobUrl = jobUrl;
  if (applicationLink) out.applicationLink = applicationLink;
  if (jobType) out.jobType = jobType;
  if (jobLevel) out.jobLevel = jobLevel;
  if (jobFunction) out.jobFunction = jobFunction;
  if (disciplines) out.disciplines = disciplines;
  if (degreeRequired) out.degreeRequired = degreeRequired;
  if (starting) out.starting = starting;
  if (jobDescription) out.jobDescription = jobDescription;

  return out;
}
