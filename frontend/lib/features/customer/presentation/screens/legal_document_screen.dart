import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../../../shared/widgets/infurnus_button.dart';

class LegalDocumentScreen extends StatefulWidget {
  final String title;
  final String content;

  const LegalDocumentScreen({
    super.key,
    required this.title,
    required this.content,
  });

  @override
  State<LegalDocumentScreen> createState() => _LegalDocumentScreenState();
}

class _LegalDocumentScreenState extends State<LegalDocumentScreen> {
  static const Color mainBg = Color(0xFFF8FAFC);
  static const Color cardBg = Color(0xFFFFFFFF);
  static const Color borderCard = Color(0xFFE2E8F0);
  static const Color textBlack = Color(0xFF0F172A);
  static const Color textGray = Color(0xFF64748B);
  static const Color brandGreen = Color(0xFF10B981);
  static const Color darkGreen = Color(0xFF065F46);

  final ScrollController _scrollController = ScrollController();

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isPrivacy = widget.title.toLowerCase().contains('privacy');
    final isTerms = widget.title.toLowerCase().contains('term');

    final sections = _parseSections(widget.content);

    return Scaffold(
      backgroundColor: mainBg,
      appBar: AppBar(
        title: Text(
          widget.title,
          style: const TextStyle(
            color: textBlack,
            fontWeight: FontWeight.bold,
            fontSize: 18,
          ),
        ),
        elevation: 0.5,
        backgroundColor: cardBg,
        foregroundColor: textBlack,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: textBlack),
          onPressed: () => context.pop(),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.share_outlined, color: textBlack),
            tooltip: 'Share',
            onPressed: () {
              Clipboard.setData(ClipboardData(text: widget.content));
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  backgroundColor: darkGreen,
                  content: Text('${widget.title} copied to clipboard'),
                ),
              );
            },
          ),
        ],
      ),
      body: SingleChildScrollView(
        controller: _scrollController,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 1. Header Hero Card
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [
                    Color(0xFF032213),
                    Color(0xFF064E2A),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(20),
                boxShadow: [
                  BoxShadow(
                    color: darkGreen.withValues(alpha: 0.2),
                    blurRadius: 14,
                    offset: const Offset(0, 6),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: brandGreen.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Icon(
                          isPrivacy
                              ? Icons.security_rounded
                              : (isTerms
                                  ? Icons.gavel_rounded
                                  : Icons.article_rounded),
                          color: const Color(0xFFA7F3D0),
                          size: 20,
                        ),
                      ),
                      const SizedBox(width: 10),
                      const Text(
                        'INFURNUS LOGISTICS TECHNOLOGIES',
                        style: TextStyle(
                          color: Color(0xFFA7F3D0),
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 0.6,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Text(
                    widget.title,
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Official Legal Documentation & Statutory Compliance Framework',
                    style: TextStyle(fontSize: 12, color: Color(0xFFD1FAE5)),
                  ),
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    children: [
                      _buildHeaderBadge(
                        Icons.update_rounded,
                        'Last Updated: October 2026',
                      ),
                      _buildHeaderBadge(
                        Icons.verified_rounded,
                        isPrivacy
                            ? 'DPDP Act, 2023 Compliant'
                            : 'IT Act, 2000 & Contract Act',
                      ),
                      _buildHeaderBadge(
                        Icons.numbers_rounded,
                        'v2.4 • Effective',
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),

            // 2. Sections Container
            ...sections.map((sec) => _buildSectionCard(sec)),

            // 3. Grievance Officer Card
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(top: 10, bottom: 20),
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: const Color(0xFFF0FDF4),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFBBF7D0)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(
                        Icons.support_agent_rounded,
                        color: darkGreen,
                        size: 22,
                      ),
                      SizedBox(width: 8),
                      Text(
                        'Statutory Grievance Redressal',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: darkGreen,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'For any questions, privacy requests, or grievances under the DPDP Act 2023 or IT Rules 2021, contact our dedicated Grievance Officer:',
                    style: TextStyle(fontSize: 12, color: textGray, height: 1.4),
                  ),
                  const SizedBox(height: 10),
                  _buildGrievanceRow('Officer', 'Legal Compliance Officer'),
                  _buildGrievanceRow('Email', 'support@infurnus.com'),
                  _buildGrievanceRow('Address', 'INFURNUS Logistics Head Office, India'),
                  _buildGrievanceRow('SLA', 'Acknowledgment in 24 hrs • Resolution in 15 days'),
                ],
              ),
            ),

            // 4. Accept CTA Button
            InfurnusButton(
              text: 'I Understand & Accept',
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Thank you for reviewing INFURNUS legal terms.'),
                    duration: Duration(seconds: 2),
                  ),
                );
                context.pop();
              },
              isFullWidth: true,
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _buildHeaderBadge(IconData icon, String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: const Color(0xFFA7F3D0)),
          const SizedBox(width: 5),
          Text(
            text,
            style: const TextStyle(
              fontSize: 10,
              color: Colors.white,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionCard(_LegalSection section) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderCard),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (section.heading.isNotEmpty) ...[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 3,
                  height: 18,
                  margin: const EdgeInsets.only(top: 2, right: 8),
                  decoration: BoxDecoration(
                    color: brandGreen,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                Expanded(
                  child: Text(
                    section.heading,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      color: textBlack,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
          ],
          ...section.paragraphs.map((p) {
            final isBullet = p.trim().startsWith('-') ||
                p.trim().startsWith('•') ||
                RegExp(r'^\d+\.').hasMatch(p.trim());

            if (isBullet) {
              return Padding(
                padding: const EdgeInsets.only(bottom: 6, left: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Padding(
                      padding: EdgeInsets.only(top: 4, right: 8),
                      child: Icon(
                        Icons.check_circle_outline_rounded,
                        size: 14,
                        color: brandGreen,
                      ),
                    ),
                    Expanded(
                      child: Text(
                        p.replaceFirst(RegExp(r'^[-•\d+\.]\s*'), ''),
                        style: const TextStyle(
                          fontSize: 13,
                          color: textBlack,
                          height: 1.45,
                        ),
                      ),
                    ),
                  ],
                ),
              );
            }

            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                p,
                style: const TextStyle(
                  fontSize: 13,
                  color: textGray,
                  height: 1.5,
                ),
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildGrievanceRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 70,
            child: Text(
              '$label:',
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.bold,
                color: textBlack,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 11,
                color: textBlack,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<_LegalSection> _parseSections(String raw) {
    final lines = raw.split('\n');
    final List<_LegalSection> list = [];
    String currentHeading = '';
    List<String> currentParagraphs = [];

    for (var line in lines) {
      final trimmed = line.trim();
      if (trimmed.isEmpty) continue;

      // Skip document title headers at the very start
      if (trimmed == 'PRIVACY POLICY' ||
          trimmed == 'TERMS OF SERVICE' ||
          trimmed == 'CONTENT POLICY' ||
          trimmed == 'INFURNUS Logistics' ||
          trimmed.startsWith('Last Updated:')) {
        continue;
      }

      // Detect numbered headings: "1. Introduction", "2. Data We Collect"
      if (RegExp(r'^\d+\.\s+[A-Za-z]').hasMatch(trimmed)) {
        if (currentHeading.isNotEmpty || currentParagraphs.isNotEmpty) {
          list.add(_LegalSection(currentHeading, currentParagraphs));
          currentParagraphs = [];
        }
        currentHeading = trimmed;
      } else {
        currentParagraphs.add(trimmed);
      }
    }

    if (currentHeading.isNotEmpty || currentParagraphs.isNotEmpty) {
      list.add(_LegalSection(currentHeading, currentParagraphs));
    }

    return list;
  }
}

class _LegalSection {
  final String heading;
  final List<String> paragraphs;

  _LegalSection(this.heading, this.paragraphs);
}
