"use client";

import { Toaster as ChakraToaster, createToaster, Portal, Stack, Toast } from "@chakra-ui/react";

// At the bottom and stacked, so messages never cover the alarm and stop buttons pinned to the top.
export const toaster = createToaster({ placement: "bottom-end", max: 3, overlap: true });

export function Toaster() {
  return (
    <Portal>
      <ChakraToaster toaster={toaster} insetInline={{ mdDown: "4" }}>
        {(toast) => (
          <Toast.Root width={{ md: "sm" }}>
            <Toast.Indicator />
            <Stack gap="1" flex="1" maxWidth="100%">
              {toast.title && <Toast.Title>{toast.title}</Toast.Title>}
            </Stack>
            <Toast.CloseTrigger />
          </Toast.Root>
        )}
      </ChakraToaster>
    </Portal>
  );
}
