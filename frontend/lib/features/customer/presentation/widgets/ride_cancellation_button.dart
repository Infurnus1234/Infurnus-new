import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../shared/widgets/infurnus_outlined_button.dart';

class RideCancellationButton extends StatefulWidget {
  final Duration Function() remaining;
  final VoidCallback onPressed;

  const RideCancellationButton({
    super.key,
    required this.remaining,
    required this.onPressed,
  });

  @override
  State<RideCancellationButton> createState() => _RideCancellationButtonState();
}

class _RideCancellationButtonState extends State<RideCancellationButton> {
  Timer? _timer;
  late final AppLifecycleListener _lifecycle;
  int _seconds = 0;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(onResume: () => setState(_sync));
    _sync();
  }

  @override
  void didUpdateWidget(covariant RideCancellationButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    _sync();
  }

  void _sync() {
    _timer?.cancel();
    final micros = widget.remaining().inMicroseconds;
    const second = Duration.microsecondsPerSecond;
    _seconds = micros > 0 ? (micros + second - 1) ~/ second : 0;
    if (_seconds == 0) return;
    final untilNextSecond = micros - (_seconds - 1) * second;
    _timer = Timer(
      Duration(microseconds: untilNextSecond),
      () => setState(_sync),
    );
  }

  @override
  void dispose() {
    _timer?.cancel();
    _lifecycle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final seconds = _seconds;
    if (seconds == 0) return const SizedBox.shrink();
    final button = InfurnusOutlinedButton(
      text: 'Cancel Ride',
      onPressed: () {
        if (widget.remaining() <= Duration.zero) {
          setState(_sync);
          return;
        }
        widget.onPressed();
      },
    );

    final minutesText = (seconds ~/ 60).toString().padLeft(2, '0');
    final secondsText = (seconds % 60).toString().padLeft(2, '0');
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        button,
        const SizedBox(height: 4),
        Text(
          '$minutesText:$secondsText left',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }
}
