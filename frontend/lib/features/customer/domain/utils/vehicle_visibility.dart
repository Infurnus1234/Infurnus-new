/// Only validates the shape of a selection. The backend owns catalog eligibility.
bool isCustomerVehicleVisible(String sector, String code, [String? name]) =>
    const {
      'passenger',
      'rental',
      'logistics',
      'premium',
      'service',
    }.contains(sector) &&
    code.trim().isNotEmpty;
