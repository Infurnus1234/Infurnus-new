// Synthetic local-test polygon only. It is not an approved production boundary.
export const syntheticDispatchCity = {
  cityId: 'TEST_ONLY_CITY',
  boundaryGeoJson: JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [77, 12],
        [78, 12],
        [78, 14],
        [77, 14],
        [77, 12],
      ],
    ],
  }),
};
import { ServiceAreaPolicy } from '../../maps/service-area.js';
// Explicit test dependency; never read by production configuration.
export const syntheticDispatchAreas = {
  cities: [
    {
      id: syntheticDispatchCity.cityId,
      name: 'TEST ONLY CITY',
      boundaryFile: 'SYNTHETIC',
      approvalReference: 'TEST ONLY',
      area: new ServiceAreaPolicy(JSON.parse(syntheticDispatchCity.boundaryGeoJson), true),
    },
  ],
};
