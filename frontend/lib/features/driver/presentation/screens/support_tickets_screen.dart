import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../../../shared/widgets/infurnus_loader.dart';
import '../../../../shared/widgets/infurnus_text_field.dart';
import '../../data/models/support_ticket_model.dart';
import '../providers/driver_providers.dart';

final supportTicketsFutureProvider =
    FutureProvider.autoDispose<List<SupportTicketModel>>((ref) async {
  final dataSource = ref.watch(driverRemoteDataSourceProvider);
  return dataSource.listSupportTickets();
});

class SupportTicketsScreen extends ConsumerStatefulWidget {
  const SupportTicketsScreen({super.key});

  @override
  ConsumerState<SupportTicketsScreen> createState() => _SupportTicketsScreenState();
}

class _SupportTicketsScreenState extends ConsumerState<SupportTicketsScreen> {
  final _subjectController = TextEditingController();
  final _messageController = TextEditingController();
  String _selectedCategory = 'Trip Issue';
  bool _isCreating = false;

  final List<String> _categories = [
    'Trip Issue',
    'Payment & Payout',
    'Vehicle & Documents',
    'App Bug / Performance',
    'Account & Safety',
    'Other Query',
  ];

  @override
  void dispose() {
    _subjectController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  void _showCreateTicketSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF141916),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 24,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Create Support Ticket',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, color: Colors.white70),
                    onPressed: () => Navigator.pop(ctx),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              const Text('Category', style: TextStyle(color: Colors.white70, fontSize: 13)),
              const SizedBox(height: 6),
              DropdownButtonFormField<String>(
                value: _selectedCategory,
                dropdownColor: const Color(0xFF1E2621),
                decoration: InputDecoration(
                  filled: true,
                  fillColor: const Color(0xFF1E2621),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                ),
                items: _categories.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
                onChanged: (val) {
                  if (val != null) setSheetState(() => _selectedCategory = val);
                },
              ),
              const SizedBox(height: 14),
              InfurnusTextField(
                label: 'Subject',
                controller: _subjectController,
                hintText: 'Brief issue summary',
              ),
              const SizedBox(height: 14),
              InfurnusTextField(
                label: 'Message',
                controller: _messageController,
                hintText: 'Provide complete details of the issue...',
                maxLines: 4,
              ),
              const SizedBox(height: 22),
              InfurnusButton(
                text: _isCreating ? 'Submitting...' : 'Submit Ticket',
                isLoading: _isCreating,
                onPressed: _isCreating
                    ? null
                    : () async {
                        if (_subjectController.text.trim().isEmpty ||
                            _messageController.text.trim().isEmpty) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Please fill subject and message')),
                          );
                          return;
                        }

                        setSheetState(() => _isCreating = true);
                        try {
                          final ds = ref.read(driverRemoteDataSourceProvider);
                          await ds.createSupportTicket({
                            'category': _selectedCategory,
                            'subject': _subjectController.text.trim(),
                            'message': _messageController.text.trim(),
                          });

                          _subjectController.clear();
                          _messageController.clear();
                          if (ctx.mounted) Navigator.pop(ctx);
                          ref.invalidate(supportTicketsFutureProvider);

                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Support ticket created successfully'),
                                backgroundColor: AppColors.primaryGreen,
                              ),
                            );
                          }
                        } catch (e) {
                          setSheetState(() => _isCreating = false);
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text('Failed: $e')),
                            );
                          }
                        }
                      },
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ticketsAsync = ref.watch(supportTicketsFutureProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Support & Helpdesk'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(supportTicketsFutureProvider),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _showCreateTicketSheet,
        backgroundColor: AppColors.primaryGreen,
        icon: const Icon(Icons.add, color: Colors.black),
        label: const Text('New Ticket', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
      ),
      body: ticketsAsync.when(
        loading: () => const InfurnusLoader(message: 'Loading support tickets...'),
        error: (err, _) => Center(child: Text('Error: $err')),
        data: (tickets) {
          if (tickets.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.support_agent, size: 64, color: Colors.grey[600]),
                  const SizedBox(height: 16),
                  const Text(
                    'No Support Tickets',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Need assistance? Tap "New Ticket" to contact support.',
                    style: TextStyle(color: Colors.grey[400], fontSize: 13),
                  ),
                ],
              ),
            );
          }

          return ListView.separated(
            padding: const EdgeInsets.all(20),
            itemCount: tickets.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, idx) {
              final ticket = tickets[idx];
              final isResolved = ticket.status == 'RESOLVED' || ticket.status == 'CLOSED';

              return InfurnusCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          ticket.ticketNumber,
                          style: const TextStyle(
                            color: AppColors.primaryGreen,
                            fontWeight: FontWeight.bold,
                            fontSize: 13,
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: isResolved
                                ? AppColors.primaryGreen.withOpacity(0.15)
                                : Colors.amber.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(
                              color: isResolved ? AppColors.primaryGreen : Colors.amber,
                              width: 0.8,
                            ),
                          ),
                          child: Text(
                            ticket.status,
                            style: TextStyle(
                              color: isResolved ? AppColors.primaryGreen : Colors.amber,
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      ticket.subject,
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      ticket.message,
                      style: TextStyle(color: Colors.grey[400], fontSize: 13, height: 1.3),
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 10),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: Colors.white.withOpacity(0.06),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            ticket.category,
                            style: TextStyle(color: Colors.grey[300], fontSize: 11),
                          ),
                        ),
                        if (ticket.createdAt != null)
                          Text(
                            ticket.createdAt!.toLocal().toString().split('.')[0],
                            style: TextStyle(color: Colors.grey[500], fontSize: 11),
                          ),
                      ],
                    ),
                  ],
                ),
              );
            },
          );
        },
      ),
    );
  }
}
