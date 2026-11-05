"use client";

import { Box, HStack, Icon, Text } from "@chakra-ui/react";
import type { IconType } from "react-icons";
import { chamfer } from "./theme";

export function SummaryTile({
  icon,
  label,
  value,
  dark = false,
}: {
  icon: IconType;
  label: string;
  value: string;
  dark?: boolean;
}) {
  return (
    <Box
      bg={dark ? "ink" : "surface"}
      color={dark ? "inkContrast" : "ink"}
      p={{ base: "4", md: "5" }}
      style={{ clipPath: chamfer() }}
    >
      <HStack gap="2" color={dark ? "inkContrast" : "fg.muted"}>
        <Icon as={icon} color={dark ? "inkContrast" : "copper"} aria-hidden />
        <Text textStyle="sm" fontWeight="bold" truncate>
          {label}
        </Text>
      </HStack>
      <Text
        mt={{ base: "4", md: "6" }}
        fontSize={{ base: "2xl", md: "4xl" }}
        fontWeight="800"
        lineHeight="1"
        letterSpacing="-0.02em"
        fontVariantNumeric="tabular-nums"
        data-summary={label}
      >
        {value}
      </Text>
    </Box>
  );
}
