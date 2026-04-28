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
  order: number;
  createdAt?: any;
  updatedAt?: any;
}
