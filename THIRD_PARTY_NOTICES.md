# Third-Party Notices

whisperlane's own source is covered by the root `LICENSE-MIT` and
`LICENSE-APACHE`. This file covers the speech engines the build fetches, the
model weights the product downloads, and the runtime components that travel
with an engine. None of these binaries or weights are committed to this
repository; the notices exist because they are distributed or downloaded.

## whisper.cpp

MIT License. Copyright (c) 2023-2024 The ggml authors.

The Whisper engine is built from unmodified [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
sources by the companion repository
[fahrim/whisper-vulkan-win](https://github.com/fahrim/whisper-vulkan-win),
pinned by tag and reviewed digest. The built executables are fetched at build
time and shipped inside the installer.

## transcribe.cpp

MIT License. Copyright (c) 2026 The transcribe.cpp authors.

The multilingual engine is built from [transcribe.cpp](https://github.com/anomalyco/transcribe.cpp)
at a pinned revision by the companion repository
[fahrim/transcribe-vulkan-win](https://github.com/fahrim/transcribe-vulkan-win),
pinned by tag and reviewed digest. The built executables are fetched at build
time and shipped inside the installer.

## Whisper model weights

The Whisper models offered in Settings are the ggml conversions published in
[ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp), derived
from OpenAI's Whisper models and distributed under the MIT License. They are
downloaded by the user, never bundled.

## Qwen3-ASR 0.6B

Apache License 2.0. Base model: [Qwen/Qwen3-ASR-0.6B](https://huggingface.co/Qwen/Qwen3-ASR-0.6B).

The offered file is `Qwen3-ASR-0.6B-Q8_0.gguf` from
[handy-computer/Qwen3-ASR-0.6B-gguf](https://huggingface.co/handy-computer/Qwen3-ASR-0.6B-gguf)
at revision `e4e16599b900eb0cb36e524514756bb92eb092b7`. It is a user
download, never bundled. The conversion notice supplied with the file:

> Modifications: handy-computer converted
> https://huggingface.co/Qwen/Qwen3-ASR-0.6B at commit 5eb1441 to GGUF for
> transcribe.cpp (https://github.com/handy-computer/transcribe.cpp). Conversion
> repackages the weights, renaming and re-laying-out tensors; the quantized
> files (Q8_0, Q6_K, Q5_K_M, Q4_K_M) also store them at reduced numeric
> precision. The weights were not retrained or fine-tuned.

The weights are provided as-is, without warranties, as the licence states.

## Microsoft OpenMP runtime

`vcomp140.dll` travels beside the Whisper engine because OpenMP remains the
faster processor path. It is part of the Microsoft Visual C++ redistributable
and is redistributed under those terms. It imports only `KERNEL32.dll`, so it
brings no C runtime of its own.
