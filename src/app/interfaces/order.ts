import { CartItem } from './cart-item';

export type OrderStatus = 'PENDING' | 'RECEIVED' | 'CONFIRMED' | 'CANCELLED' | 'REFUNDED';

export interface Order {
  id?: string;
  userId: string;
  items: CartItem[];
  total: number;
  status: OrderStatus;
  paymentMethod: 'PIX' | 'BOLETO' | 'CREDIT_CARD';
  asaasPaymentId?: string;
  sellerIds: string[]; // Lista de IDs de todos os vendedores envolvidos no pedido
  createdAt: any;
  updatedAt?: any;
  
  // Dados de entrega/comprador salvos no momento da compra
  customerData: {
    name: string;
    cpf: string;
    phone: string;
    email: string;
  };
  addressData: {
    street: string;
    number: string;
    city: string;
    state: string;
    postalCode: string;
  };
}
