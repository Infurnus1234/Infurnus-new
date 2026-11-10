import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../shared/widgets/infurnus_outlined_button.dart';

class RideCancellationButton extends StatefulWidget {
  final int Function()? remainingSeconds;
  final VoidCallback onPressed;

  const RideCancellationButton({
    super.key,
    required this.remainingSeconds,
    required this.onPressed,
  });

  @override
  State<RideCancellationButton> createState() => _RideCancellationButtonState();
}

class _RideCancellationButtonState extends State<RideCancellationButton> {
  Timer? _timer;
  int? _seconds;

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(covariant RideCancellationButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    _sync();
  }

  void _sync() {
    _seconds = widget.remainingSeconds?.call();
    if ((_seconds ?? 0) > 0) {
      _timer ??= Timer.periodic(const Duration(seconds: 1), (_) {
        final seconds = widget.remainingSeconds?.call();
        if (seconds != _seconds) setState(_sync);
      });
    } else {
      _timer?.cancel();
      _timer = null;
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final seconds = _seconds;
    final button = InfurnusOutlinedButton(
      text: 'Cancel Ride',
      onPressed: seconds == 0
          ? null
          : () {
              if (widget.remainingSeconds?.call() == 0) {
                setState(_sync);
                return;
              }
              widget.onPressed();
            },
    );
    if (seconds == null) return button;

    final minutesText = (seconds ~/ 60).toString().padLeft(2, '0');
    final secondsText = (seconds % 60).toString().padLeft(2, '0');
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        button,
        const SizedBox(height: 4),
        Text(
          seconds == 0
              ? 'Cancellation unavailable'
              : '$minutesText:$secondsText left',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }
}
