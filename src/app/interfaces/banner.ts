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
  /** Arte do celular (app e site em tela pequena): 1080 × 400 px, 2,7:1. */
  imageURL: string;
  /**
   * Arte do computador (home do site): 1920 × 480 px, 4:1. Opcional — sem ela
   * o site mostra a arte do celular inteira, centralizada sobre um fundo
   * desfocado dela mesma. Ver `core/banner-formats.ts`.
   */
  desktopImageURL?: string;
  backgroundColor: string;
  textColor: string;
  status: 'active' | 'inactive' | 'scheduled';
  scheduledStart?: string; // ISO date string
  scheduledEnd?: string;   // ISO date string
  scheduledDays?: number[]; // [0-6] where 0 is Sunday
  scheduledDates?: string[]; // Local dates in YYYY-MM-DD format
  dailySchedules?: Record<string, BannerDailySchedule>; // Per-date carousel planning
  order: number;
  isDefault?: boolean;
  createdAt?: any;
  updatedAt?: any;
}
