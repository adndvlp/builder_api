import AuthCheck from "../../components/AuthCheck";
import Link from "next/link";
import {
  Button,
  Heading,
  VStack,
  Text,
  Box,
  Code,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
} from "@chakra-ui/react";

export default function NewExperimentPage({}) {
  return (
    <AuthCheck>
      <NewExperimentInfo />
    </AuthCheck>
  );
}

function NewExperimentInfo() {
  return (
    <VStack spacing={8} maxWidth="800px" align="stretch">
      <Heading>Experiment Creation via API</Heading>

      <Alert status="info" variant="left-accent">
        <AlertIcon />
        <Box>
          <AlertTitle>Experiments are created via API</AlertTitle>
          <AlertDescription>
            Experiments are no longer created through this interface. They are
            automatically created when you call the API endpoint from your
            external system.
          </AlertDescription>
        </Box>
      </Alert>

      <Box>
        <Heading size="md" mb={4}>
          API Endpoint
        </Heading>
        <Code p={4} borderRadius="md" display="block" whiteSpace="pre">
          POST /apicreateexperiment
        </Code>
      </Box>

      <Box>
        <Heading size="md" mb={4}>
          Required Parameters
        </Heading>
        <VStack align="stretch" spacing={2}>
          <Code p={3} borderRadius="md">
            experimentID: string - The unique ID for the experiment
          </Code>
          <Code p={3} borderRadius="md">
            experimentName: string - The name of the experiment
          </Code>
          <Code p={3} borderRadius="md">
            userUID: string - Your user ID
          </Code>
        </VStack>
      </Box>

      <Box>
        <Heading size="md" mb={4}>
          Example Request
        </Heading>
        <Code
          p={4}
          borderRadius="md"
          display="block"
          whiteSpace="pre"
          fontSize="sm"
        >
          {`{
  "experimentID": "exp_abc123",
  "experimentName": "My Research Study",
  "userUID": "your_user_id_here"
}`}
        </Code>
      </Box>

      <Box>
        <Text fontSize="sm" color="gray.400">
          The API will automatically:
        </Text>
        <VStack align="stretch" spacing={1} mt={2} ml={4}>
          <Text fontSize="sm">
            • Create a Dropbox folder: /DataPipe/[experimentName]
          </Text>
          <Text fontSize="sm">• Save experiment info in Firestore</Text>
          <Text fontSize="sm">
            • Associate the experiment with your user account
          </Text>
        </VStack>
      </Box>

      <Link href="/admin">
        <Button colorScheme="brandTeal" size="lg" width="full">
          View Your Experiments
        </Button>
      </Link>
    </VStack>
  );
}
