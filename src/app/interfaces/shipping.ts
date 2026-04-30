export interface MelhorEnvioConfig {
  accessToken: string;
  refreshToken?: string;
  isSandbox: boolean;
  senderName: string;
  senderPhone: string;
  senderEmail: string;
  senderCpfCnpj: string;
  address: {
    street: string;
    number: string;
    complement?: string;
    district: string;
    city: string;
    state: string;
    zipCode: string;
  };
}

export interface ShippingAnalysis {
  totalSpent: number;
  totalLabelsGenerated: number;
  averageCost: number;
  statusSummary: {
    pending: number;
    released: number;
    posted: number;
    delivered: number;
    cancelled: number;
  };
  carrierPerformance: {
    carrier: string;
    count: number;
    totalCost: number;
  }[];
}

export interface ShippingQuote {
  id: number; // service id
  name: string;
  price: number;
  delivery_time: number;
  company: {
    name: string;
    picture: string;
  };
  error?: string;
}
