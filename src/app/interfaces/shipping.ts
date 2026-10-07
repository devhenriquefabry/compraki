export interface MelhorEnvioConfig {
  /** Só para ENVIAR um token novo; o servidor nunca devolve o token salvo. */
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

/** Resposta de `melhorEnvioSettings`: configuração sem os tokens. */
export interface MelhorEnvioSettings {
  config: Omit<MelhorEnvioConfig, 'accessToken' | 'refreshToken'>;
  hasToken: boolean;
  /** Últimos 4 caracteres do token salvo, para o admin reconhecer qual é. */
  tokenEnd: string | null;
  hasRefreshToken: boolean;
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
