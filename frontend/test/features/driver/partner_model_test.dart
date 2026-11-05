import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/driver/data/models/partner_model.dart';

void main() {
  group('PartnerModel JSON serialization', () {
    test(
      'public ID preserves resource identity, old caches and wider strings',
      () {
        final record = <String, dynamic>{
          'id': 'resource-uuid',
          'userId': 'account-uuid',
          'businessName': 'Fleet',
          'approvalStatus': 'pending',
          'availabilityStatus': 'offline',
          'createdAt': '2026-01-01T00:00:00Z',
          'updatedAt': '2026-01-01T00:00:00Z',
        };
        expect(PartnerModel.fromJson(record).publicId, isNull);
        for (final id in ['100001', '1000000', '100000000000']) {
          final model = PartnerModel.fromJson({...record, 'publicId': id});
          expect(model.publicId, id);
          expect(model.id, 'resource-uuid');
          expect(model.toJson()['publicId'], id);
        }
        for (final invalid in ['UUID-123', '100001\n', 100001]) {
          expect(
            PartnerModel.fromJson({...record, 'publicId': invalid}).publicId,
            isNull,
          );
        }
      },
    );
    test('should correctly deserialize valid partner JSON', () {
      final json = {
        'id': 'p-123',
        'userId': 'u-456',
        'businessName': 'Express Delivery',
        'businessDescription': 'Fast logistics',
        'approvalStatus': 'approved',
        'availabilityStatus': 'available',
        'createdAt': '2023-01-01T10:00:00.000Z',
        'updatedAt': '2023-01-02T10:00:00.000Z',
      };

      final model = PartnerModel.fromJson(json);

      expect(model.id, 'p-123');
      expect(model.userId, 'u-456');
      expect(model.businessName, 'Express Delivery');
      expect(model.businessDescription, 'Fast logistics');
      expect(model.approvalStatus, 'approved');
      expect(model.availabilityStatus, 'available');
    });

    test('should correctly serialize PartnerModel to JSON', () {
      final model = PartnerModel(
        id: 'p-123',
        userId: 'u-456',
        businessName: 'Express Delivery',
        businessDescription: 'Fast logistics',
        approvalStatus: 'approved',
        availabilityStatus: 'available',
        createdAt: DateTime.parse('2023-01-01T10:00:00.000Z'),
        updatedAt: DateTime.parse('2023-01-02T10:00:00.000Z'),
      );

      final json = model.toJson();

      expect(json['id'], 'p-123');
      expect(json['userId'], 'u-456');
      expect(json['businessName'], 'Express Delivery');
      expect(json['approvalStatus'], 'approved');
    });
  });
}
