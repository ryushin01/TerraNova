import { Container, Heading, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { MAIN_ID } from "./skip-link";

/** The shared body of the error and not-found screens: what happened and what to do next. */
export function ErrorNotice({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Container as="main" id={MAIN_ID} tabIndex={-1} maxW="sm" px="4" py={{ base: "16", md: "24" }}>
      <Stack gap="3" align="flex-start">
        <Heading as="h1" fontSize="3xl" fontWeight="800" letterSpacing="-0.02em">
          {title}
        </Heading>
        <Text color="fg.muted">{description}</Text>
        <Stack direction="row" gap="2" pt="3">
          {children}
        </Stack>
      </Stack>
    </Container>
  );
}
