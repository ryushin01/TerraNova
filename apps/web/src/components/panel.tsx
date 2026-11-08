"use client";

import { Box, type BoxProps, HStack, Icon, type StackProps, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import type { IconType } from "react-icons";

/** Contour lines from a survey map, in the current text colour. Decoration only. */
export function Contours(props: BoxProps) {
  return (
    <Box
      aria-hidden
      position="absolute"
      pointerEvents="none"
      bg="currentColor"
      css={{ maskImage: "url(/contours.svg)", maskSize: "cover", maskPosition: "center", maskRepeat: "no-repeat" }}
      {...props}
    />
  );
}

/** A hairline with survey ticks along it. Decoration only. */
export function ScaleRule(props: BoxProps) {
  return (
    <Box
      aria-hidden
      h="7px"
      borderTopWidth="1px"
      borderColor="currentColor"
      opacity={0.45}
      backgroundImage="repeating-linear-gradient(to right, currentColor 0 1px, transparent 1px 48px)"
      {...props}
    />
  );
}

/** A small icon and caption at the top of a panel. */
export function PanelLabel({ icon, children, ...rest }: { icon?: IconType; children: ReactNode } & StackProps) {
  return (
    <HStack gap="2" {...rest}>
      {icon && <Icon as={icon} boxSize="4" aria-hidden />}
      <Text textStyle="caption" truncate>
        {children}
      </Text>
    </HStack>
  );
}

/** One region of the dashboard grid. */
export function Panel({ night = false, children, ...rest }: { night?: boolean; children: ReactNode } & BoxProps) {
  return (
    <Box
      position="relative"
      overflow="hidden"
      borderRadius="2xl"
      p={{ base: "4", md: "5" }}
      bg={night ? "night.bg" : "surface"}
      color={night ? "night.fg" : "ink"}
      {...rest}
    >
      {children}
    </Box>
  );
}
