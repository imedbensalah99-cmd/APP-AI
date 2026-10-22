export const STATUSES = [
  'Wishlist',
  'Applied',
  'Screening',
  'Interview',
  'Offer',
  'Rejected',
  'Withdrawn',
] as const;

export type ApplicationStatus = (typeof STATUSES)[number];

export interface JobApplication {
  id: string;
  company: string;
  role: string;
  status: ApplicationStatus;
  location: string;
  sourceUrl: string;
  appliedOn: string;
  deadline: string;
  followUpOn: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type ApplicationFields = Pick<JobApplication,
  'company' | 'role' | 'status' | 'location' | 'sourceUrl' |
  'appliedOn' | 'deadline' | 'followUpOn' | 'notes'>;

export const EMPTY_FIELDS: ApplicationFields = {
  company: '',
  role: '',
  status: 'Wishlist',
  location: '',
  sourceUrl: '',
  appliedOn: '',
  deadline: '',
  followUpOn: '',
  notes: '',
};
