import 'package:flutter/material.dart';

class InfurnusSkeleton extends StatefulWidget {
  final double? width;
  final double? height;
  final double borderRadius;

  const InfurnusSkeleton({
    super.key,
    this.width,
    this.height,
    this.borderRadius = 8.0,
  });

  @override
  State<InfurnusSkeleton> createState() => _InfurnusSkeletonState();
}

class _InfurnusSkeletonState extends State<InfurnusSkeleton>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat();
    _animation = Tween<double>(begin: -1.0, end: 2.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _animation,
      builder: (context, child) {
        return Container(
          width: widget.width,
          height: widget.height,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(widget.borderRadius),
            gradient: LinearGradient(
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              colors: const [
                Color(0xFFEEEEEE),
                Color(0xFFF8F8F8),
                Color(0xFFEEEEEE),
              ],
              stops: [
                (_animation.value - 0.3).clamp(0.0, 1.0),
                _animation.value.clamp(0.0, 1.0),
                (_animation.value + 0.3).clamp(0.0, 1.0),
              ],
            ),
          ),
        );
      },
    );
  }
}

class InfurnusSkeletonCard extends StatelessWidget {
  const InfurnusSkeletonCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey[100]!),
      ),
      child: const Row(
        children: [
          InfurnusSkeleton(width: 44, height: 44, borderRadius: 22),
          SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                InfurnusSkeleton(width: double.infinity, height: 14, borderRadius: 4),
                SizedBox(height: 8),
                InfurnusSkeleton(width: 120, height: 11, borderRadius: 4),
              ],
            ),
          ),
          SizedBox(width: 16),
          InfurnusSkeleton(width: 50, height: 16, borderRadius: 4),
        ],
      ),
    );
  }
}
