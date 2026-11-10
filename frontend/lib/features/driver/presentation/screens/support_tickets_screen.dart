import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../../../shared/widgets/infurnus_loader.dart';
import '../../../../shared/widgets/infurnus_text_field.dart';
import '../../data/models/support_ticket_model.dart';
import '../providers/driver_providers.dart';

final supportTicketsPageProvider = StateProvider.autoDispose<int>((ref) => 1);
final supportTicketsFutureProvider =
    FutureProvider.autoDispose<List<SupportTicketModel>>((ref) async {
      final dataSource = ref.watch(driverRemoteDataSourceProvider);
      return dataSource.listSupportTickets(
        page: ref.watch(supportTicketsPageProvider),
      );
    });

class SupportTicketsScreen extends ConsumerStatefulWidget {
  const SupportTicketsScreen({super.key});

  @override
  ConsumerState<SupportTicketsScreen> createState() =>
      _SupportTicketsScreenState();
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
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Create Support Ticket',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, color: Colors.white70),
                      onPressed: () => Navigator.pop(ctx),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                const Text(
                  'Category',
                  style: TextStyle(color: Colors.white70, fontSize: 13),
                ),
                const SizedBox(height: 6),
                DropdownButtonFormField<String>(
                  style: const TextStyle(color: Colors.white),
                  initialValue: _selectedCategory,
                  dropdownColor: const Color(0xFF1E2621),
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: const Color(0xFF1E2621),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  items: _categories
                      .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                      .toList(),
                  onChanged: (val) {
                    if (val != null) {
                      setSheetState(() => _selectedCategory = val);
                    }
                  },
                ),
                const SizedBox(height: 14),
                InfurnusTextField(
                  label: 'Subject',
                  labelColor: Colors.white70,
                  controller: _subjectController,
                  hintText: 'Brief issue summary',
                ),
                const SizedBox(height: 14),
                InfurnusTextField(
                  label: 'Message',
                  labelColor: Colors.white70,
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
                              const SnackBar(
                                content: Text(
                                  'Please fill subject and message',
                                ),
                              ),
                            );
                            return;
                          }

                          setState(() => _isCreating = true);
                          setSheetState(() {});
                          try {
                            final ds = ref.read(driverRemoteDataSourceProvider);
                            await ds.createSupportTicket({
                              'category': _selectedCategory,
                              'subject': _subjectController.text.trim(),
                              'message': _messageController.text.trim(),
                            });
                            if (!mounted) return;

                            _subjectController.clear();
                            _messageController.clear();
                            if (ctx.mounted) Navigator.pop(ctx);
                            ref
                                    .read(supportTicketsPageProvider.notifier)
                                    .state =
                                1;
                            ref.invalidate(supportTicketsFutureProvider);

                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text(
                                    'Support ticket created successfully',
                                  ),
                                  backgroundColor: AppColors.primaryGreen,
                                ),
                              );
                            }
                          } catch (e) {
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text('Failed: $e')),
                              );
                            }
                          } finally {
                            if (mounted) setState(() => _isCreating = false);
                            if (ctx.mounted) setSheetState(() {});
                          }
                        },
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ticketsAsync = ref.watch(supportTicketsFutureProvider);
    final page = ref.watch(supportTicketsPageProvider);

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
      floatingActionButton: ticketsAsync.valueOrNull?.isNotEmpty == true
          ? FloatingActionButton.extended(
              onPressed: _isCreating ? null : _showCreateTicketSheet,
              backgroundColor: AppColors.primaryGreen,
              icon: const Icon(Icons.add, color: Colors.black),
              label: const Text(
                'New Ticket',
                style: TextStyle(
                  color: Colors.black,
                  fontWeight: FontWeight.bold,
                ),
              ),
            )
          : null,
      body: ticketsAsync.when(
        loading: () =>
            const InfurnusLoader(message: 'Loading support tickets...'),
        error: (err, _) => Center(child: Text('Error: $err')),
        data: (tickets) {
          return ListView(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            children: [
              _buildEmailSupportBanner(context),
              const SizedBox(height: 12),
              if (tickets.isEmpty) ...[
                _buildEmptyState(context),
              ] else ...[
                ListView.separated(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: tickets.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, idx) {
                    final ticket = tickets[idx];
                    final isResolved =
                        ticket.status == 'RESOLVED' ||
                        ticket.status == 'CLOSED';

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
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 3,
                                ),
                                decoration: BoxDecoration(
                                  color: isResolved
                                      ? AppColors.primaryGreen.withValues(
                                          alpha: 0.15,
                                        )
                                      : Colors.amber.withValues(alpha: 0.15),
                                  borderRadius: BorderRadius.circular(10),
                                  border: Border.all(
                                    color: isResolved
                                        ? AppColors.primaryGreen
                                        : Colors.amber,
                                    width: 0.8,
                                  ),
                                ),
                                child: Text(
                                  ticket.status,
                                  style: TextStyle(
                                    color: isResolved
                                        ? AppColors.primaryGreen
                                        : Colors.amber,
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
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            ticket.message,
                            style: TextStyle(
                              color: Colors.grey[400],
                              fontSize: 13,
                              height: 1.3,
                            ),
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 10),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 2,
                                ),
                                decoration: BoxDecoration(
                                  color: Colors.white.withValues(alpha: 0.06),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(
                                  ticket.category,
                                  style: TextStyle(
                                    color: Colors.grey[300],
                                    fontSize: 11,
                                  ),
                                ),
                              ),
                              if (ticket.createdAt != null)
                                Text(
                                  ticket.createdAt!.toLocal().toString().split(
                                    '.',
                                  )[0],
                                  style: TextStyle(
                                    color: Colors.grey[500],
                                    fontSize: 11,
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ],
            ],
          );
        },
      ),
      bottomNavigationBar: ticketsAsync.valueOrNull?.isEmpty ?? true
          ? null
          : SafeArea(
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 8,
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    TextButton(
                      onPressed: ticketsAsync.isLoading || page == 1
                          ? null
                          : () => ref
                                .read(supportTicketsPageProvider.notifier)
                                .state--,
                      child: const Text('Previous'),
                    ),
                    Text(
                      'Page $page',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    TextButton(
                      onPressed:
                          ticketsAsync.isLoading ||
                              (ticketsAsync.valueOrNull?.length ?? 0) < 25
                          ? null
                          : () => ref
                                .read(supportTicketsPageProvider.notifier)
                                .state++,
                      child: const Text('Next'),
                    ),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildEmptyState(BuildContext context) {
    return InfurnusCard(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.primaryGreen.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.support_agent_rounded,
              size: 44,
              color: AppColors.primaryGreen,
            ),
          ),
          const SizedBox(height: 14),
          const Text(
            'No Support Tickets',
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.bold,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Need assistance? Create a ticket and our support team will respond quickly.',
            style: TextStyle(
              color: Colors.grey[400],
              fontSize: 13,
              height: 1.3,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: InfurnusButton(
              text: 'New Ticket',
              onPressed: _isCreating ? null : _showCreateTicketSheet,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmailSupportBanner(BuildContext context) {
    const supportEmail = 'support@infurnuslogistics.com';
    return InfurnusCard(
      onTap: () async {
        final emailUri = Uri(
          scheme: 'mailto',
          path: supportEmail,
          queryParameters: {'subject': 'INFURNUS Driver Support Request'},
        );
        try {
          if (await launchUrl(emailUri, mode: LaunchMode.externalApplication)) {
            return;
          }
        } catch (_) {}

        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Opening email client (mailto:$supportEmail)...'),
          ),
        );
      },
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppColors.primaryGreen.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.email_outlined,
              color: AppColors.primaryGreen,
              size: 20,
            ),
          ),
          const SizedBox(width: 10),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Email Driver Support',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                    color: Colors.white,
                  ),
                ),
                SizedBox(height: 2),
                SelectableText(
                  supportEmail,
                  style: TextStyle(
                    color: AppColors.primaryGreen,
                    fontWeight: FontWeight.w600,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          const Icon(
            Icons.open_in_new_rounded,
            size: 16,
            color: Color(0xFF9CA3AF),
          ),
        ],
      ),
    );
  }
}
