// Wave 3 (CLM-0294): Vehicle types per drivers-service OpenAPI contract.
// Source: services/drivers/contracts/api.openapi.yml

export type VehicleClass = "sedan" | "suv" | "van" | "pickup" | "motorcycle" | "truck_small";
export type VehicleStatus = "active" | "retired";

export interface Vehicle {
  id: string;
  vehicle_class: VehicleClass;
  make: string | null;
  model: string | null;
  model_year: number | null;
  color: string | null;
  plate_number: string | null;
  is_primary: boolean;
  status: VehicleStatus;
  created_at: string;
  updated_at: string;
}

export interface VehicleRegistration {
  vehicle_class: VehicleClass;
  make?: string | null;
  model?: string | null;
  model_year?: number | null;
  color?: string | null;
  plate_number?: string | null;
  is_primary?: boolean;
}

export interface VehiclePatch {
  status?: "retired";
  is_primary?: boolean;
}
