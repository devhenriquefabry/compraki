export interface BannerDailySchedule {
  startTime?: string; // HH:mm
  endTime?: string;   // HH:mm
  order?: number;
}

export interface Banner {
  id?: string;
  title: string;
  subtitle?: string;
  buttonText?: string;
  buttonLink?: string;
  imageURL: string;
  backgroundColor: string;
  textColor: string;
  status: 'active' | 'inactive' | 'scheduled';
  scheduledStart?: string; // ISO date string
  scheduledEnd?: string;   // ISO date string
  scheduledDays?: number[]; // [0-6] where 0 is Sunday
  scheduledDates?: string[]; // Local dates in YYYY-MM-DD format
  dailySchedules?: Record<string, BannerDailySchedule>; // Per-date carousel planning
  order: number;
  createdAt?: any;
  updatedAt?: any;
}
