import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/fleet_vehicle_model.dart';
import '../../domain/utils/vehicle_visibility.dart';
import 'ride_use_case_providers.dart';

final bookingCatalogProvider = FutureProvider.autoDispose
    .family<List<FleetVehicleModel>, String>((ref, sector) async {
      final items = await ref
          .watch(getFleetUseCaseProvider)
          .call(sector: sector);
      return items
          .where(
            (v) =>
                v.catalogVisible &&
                v.sector == sector &&
                isCustomerVehicleVisible(sector, v.category, v.displayName),
          )
          .toList();
    });
