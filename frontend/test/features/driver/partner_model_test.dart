import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/driver/data/models/partner_model.dart';

void main() {
  group('PartnerModel JSON serialization', () {
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
