// Wave 3 (CLM-0294): Zone types per drivers-service and geography-service OpenAPI contracts.
// Source: services/drivers/contracts/api.openapi.yml, services/geography/contracts/api.openapi.yml

export interface ServiceZone {
  zone_id: string;
  preference_rank: number;
  created_at: string;
}

export interface ServiceZoneList {
  zones: ServiceZone[];
}

export interface ServiceZoneUpdate {
  zone_id: string;
  preference_rank: number;
}

// Zone from geography service (for display names)
export interface Zone {
  id: string;
  name: string;
  parent_path: string;
}
