/** Pure: compares a candidate's recorded facts with the configurable role profile. Facts only; no score, no ranking. */
export interface RoleProfileCriteria {
  minEducation?: string | null;
  minExperienceYears?: number | null;
  maxExperienceYears?: number | null;
  minTeamMgmtYears?: number | null;
  preferredIndustries: string[];
}
export interface CandidateFacts { educationLevel?: string | null; experienceYears?: number | null; teamMgmtYears?: number | null; industries: string[] }
export type CriterionStatus = 'MET' | 'NOT_MET' | 'UNKNOWN' | 'NOT_REQUIRED';
export interface ProfileMatch {
  experience: CriterionStatus;
  teamManagement: CriterionStatus;
  industry: CriterionStatus;
  education: CriterionStatus;
  matchedIndustries: string[];
}

export function matchProfile(profile: RoleProfileCriteria, c: CandidateFacts): ProfileMatch {
  const exp: CriterionStatus = profile.minExperienceYears == null ? 'NOT_REQUIRED' : c.experienceYears == null ? 'UNKNOWN' : c.experienceYears >= profile.minExperienceYears ? 'MET' : 'NOT_MET';
  const mgmt: CriterionStatus = profile.minTeamMgmtYears == null ? 'NOT_REQUIRED' : c.teamMgmtYears == null ? 'UNKNOWN' : c.teamMgmtYears >= profile.minTeamMgmtYears ? 'MET' : 'NOT_MET';
  const wanted = profile.preferredIndustries.map((i) => i.trim().toLowerCase());
  const have = c.industries.map((i) => i.trim().toLowerCase());
  const matchedIndustries = wanted.filter((w) => have.includes(w));
  const industry: CriterionStatus = wanted.length === 0 ? 'NOT_REQUIRED' : have.length === 0 ? 'UNKNOWN' : matchedIndustries.length > 0 ? 'MET' : 'NOT_MET';
  // Education is free text (degrees vary); it is surfaced for the reviewer, never auto-judged.
  const education: CriterionStatus = !profile.minEducation ? 'NOT_REQUIRED' : 'UNKNOWN';
  return { experience: exp, teamManagement: mgmt, industry, education, matchedIndustries };
}
