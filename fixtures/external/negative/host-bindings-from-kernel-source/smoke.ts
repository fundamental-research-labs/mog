// @ts-nocheck
// Negative fixture: kernel source (non-test) must not import kernel-host-internal
// This is simulated by having a file in the kernel layer
import { prepareHostBackedDocument } from '@mog/kernel-host-internal';
