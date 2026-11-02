import { request } from "../../lib/api-client";

export type Product = {
  product_id: string;
  name: string;
  type: string;
  rate_pct: string;
  monthly_fee: string;
  terms: string;
};

export const getProducts = () => request<Product[]>("/api/products");
