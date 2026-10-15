import type { ImportField } from './import';

export const IMPORT_TEMPLATES = ['GENERIC', 'LEADSQUARED', 'ZOHO', 'HUBSPOT'] as const;
export type ImportTemplate = (typeof IMPORT_TEMPLATES)[number];

export interface TemplateDef {
  label: string;
  /** extra header names (lower-case) tried BEFORE the generic synonyms; typical CSV-export headers of that CRM */
  headers: Partial<Record<ImportField, string[]>>;
  /** exports with separate name columns: full name = first + last */
  firstName: string[];
  lastName: string[];
}

/**
 * Column templates for CSV exports of the CRMs named in the JD (LeadSquared, Zoho CRM, HubSpot). This is a CSV mapping aid
 * for migrating leads (DEC-012 greenfield + CSV import), NOT a live API integration. Header names follow each product's
 * standard export and MUST be confirmed against the real file in the dry-run preview; any field can be overridden with an
 * explicit mapping. Owner columns in those exports hold display names, not emails, so owners are only matched when the
 * file carries an email.
 */
export const TEMPLATES: Record<ImportTemplate, TemplateDef> = {
  GENERIC: { label: 'Generic CSV', headers: {}, firstName: [], lastName: [] },
  LEADSQUARED: {
    label: 'LeadSquared export',
    headers: {
      email: ['email address', 'emailaddress'],
      phone: ['mobile', 'phone', 'mobile number'],
      source: ['source', 'lead source'],
      ownerEmail: ['owner email', 'owner email address'],
      note: ['notes', 'description'],
      program: ['mx_course', 'course', 'program'],
    },
    firstName: ['first name', 'firstname'],
    lastName: ['last name', 'lastname'],
  },
  ZOHO: {
    label: 'Zoho CRM export',
    headers: {
      email: ['email'],
      phone: ['mobile', 'phone'],
      source: ['lead source'],
      ownerEmail: ['lead owner email', 'owner email'],
      note: ['description'],
      estimatedValue: ['annual revenue', 'amount'],
    },
    firstName: ['first name'],
    lastName: ['last name'],
  },
  HUBSPOT: {
    label: 'HubSpot export',
    headers: {
      email: ['email'],
      phone: ['mobile phone number', 'phone number'],
      source: ['original source', 'original source type'],
      ownerEmail: ['contact owner email', 'owner email'],
      note: ['notes', 'description'],
      preferredLanguage: ['preferred language', 'language'],
    },
    firstName: ['first name'],
    lastName: ['last name'],
  },
};
