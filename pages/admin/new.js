import { customAlphabet } from "nanoid";
import AuthCheck from "../../components/AuthCheck";
import { doc, getDoc, writeBatch, arrayUnion } from "firebase/firestore";
import { db, auth } from "../../lib/firebase";
import { useContext, useState } from "react";
import { UserContext } from "../../lib/context";
import { useDocumentData } from "react-firebase-hooks/firestore";
import Link from "next/link";
import Router from "next/router";
import DropboxToken from "../../components/account/DropboxToken";
import GithubToken from "../../components/account/GithubToken";
import {
  Button,
  Stack,
  Heading,
  FormControl,
  FormLabel,
  Input,
  Spinner,
  InputGroup,
  InputLeftAddon,
  FormErrorMessage,
  FormHelperText,
  VStack,
  Text,
  Select,
} from "@chakra-ui/react";

export default function NewExperimentPage({}) {
  return (
    <AuthCheck>
      <NewExperimentForm />
    </AuthCheck>
  );
}

function NewExperimentForm() {
  const { user } = useContext(UserContext);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dropboxError, setDropboxError] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [dataComponentError, setDataComponentError] = useState(false);

  const [data, loading, error] = useDocumentData(doc(db, "users", user.uid));
  if (data) {
    console.log("Datos del usuario desde Firestore:", data);
  }

  return (
    <>
      {loading && <Spinner color="green.500" size={"xl"} />}
      {data && data.dropboxTokens && data.githubTokens && (
        <Stack spacing={6} maxWidth="540px">
          <Heading>Create a New Experiment</Heading>
          <FormControl id="title" isInvalid={titleError}>
            <FormLabel>Title</FormLabel>
            <Input type="text" onChange={() => setTitleError(false)} />
            <FormErrorMessage color={"red"}>
              This field is required
            </FormErrorMessage>
          </FormControl>
          <FormControl id="dropbox-folder" isInvalid={dropboxError}>
            <FormLabel>Dropbox Folder Path</FormLabel>
            <Input type="text" placeholder="/DataPipe/Experiment" />
            <FormErrorMessage color={"red"}>
              Cannot connect to this Dropbox folder
            </FormErrorMessage>
            <FormHelperText color="gray">
              DataPipe will store all data in this Dropbox folder.
            </FormHelperText>
          </FormControl>
          <FormControl id="dropbox-region">
            <FormLabel>Storage Location</FormLabel>
            <Select
              defaultValue="us"
              sx={{ "> option": { background: "black", color: "white" } }}
            >
              <option value="us">United States</option>
              <option value="de-1">Germany - Frankfurt</option>
              <option value="au-1">Australia - Sydney</option>
              <option value="ca-1">Canada - Montreal</option>
            </Select>
            <FormHelperText color="gray">
              Choose the region where the data will be stored (for reference
              only).
            </FormHelperText>
          </FormControl>
          <Button
            onClick={() =>
              handleCreateExperiment(
                setIsSubmitting,
                setDropboxError,
                setTitleError,
                setDataComponentError
              )
            }
            isLoading={isSubmitting}
            colorScheme={"brandTeal"}
          >
            Create
          </Button>
        </Stack>
      )}
      {data && (!data.dropboxTokens || !data.githubTokens) && (
        <VStack spacing={6} maxWidth="540px">
          <Heading as="h2">Connect Your Accounts</Heading>
          <Text>
            Before you can create an experiment, you need to connect both your
            Dropbox and GitHub accounts.
          </Text>
          <VStack spacing={4} w="100%">
            {!data.dropboxTokens && (
              <VStack w="100%" spacing={2}>
                <Text fontWeight="bold">Dropbox (Required)</Text>
                <DropboxToken />
              </VStack>
            )}
            {!data.githubTokens && (
              <VStack w="100%" spacing={2}>
                <Text fontWeight="bold">GitHub (Required)</Text>
                <GithubToken />
              </VStack>
            )}
          </VStack>
        </VStack>
      )}
    </>
  );
}

async function handleCreateExperiment(
  setIsSubmitting,
  setDropboxError,
  setTitleError,
  setDataComponentError
) {
  setIsSubmitting(true);
  setDropboxError(false);

  const user = auth.currentUser;
  const title = document.querySelector("#title").value;
  const dropboxFolder = document.querySelector("#dropbox-folder").value;
  const region = document.querySelector("#dropbox-region").value;
  const nConditions = 1;
  const useValidation = true;
  const allowJSON = true;
  const allowCSV = true;
  const useSessionLimit = false;
  const maxSessions = 1;

  if (title.length === 0) {
    setTitleError(true);
    setIsSubmitting(false);
    return;
  }

  if (dropboxFolder.length === 0) {
    setDataComponentError(true);
    setIsSubmitting(false);
    return;
  }

  const nanoid = customAlphabet(
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    12
  );
  const id = nanoid();

  try {
    const userdoc = await getDoc(doc(db, `users/${user.uid}`));
    let dropboxToken = null;
    if (userdoc.exists()) {
      dropboxToken = userdoc.data().dropboxTokens?.access_token;
    }

    // Crear carpeta en Dropbox (si no existe) y guardar info del experimento
    // Ejemplo: crear carpeta y guardar un archivo info.json
    const folderPath = dropboxFolder.startsWith("/")
      ? dropboxFolder
      : `/${dropboxFolder}`;
    const createFolderRes = await fetch(
      "https://api.dropboxapi.com/2/files/create_folder_v2",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${dropboxToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path: folderPath,
          autorename: true,
        }),
      }
    );
    const folderData = await createFolderRes.json();
    if (folderData.error) {
      throw new Error(folderData.error_summary);
    }

    // Guardar archivo info.json en la carpeta de Dropbox
    const infoFileRes = await fetch(
      "https://content.dropboxapi.com/2/files/upload",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${dropboxToken}`,
          "Dropbox-API-Arg": JSON.stringify({
            path: `${folderPath}/info.json`,
            mode: "add",
            autorename: true,
            mute: false,
          }),
          "Content-Type": "application/octet-stream",
        },
        body: JSON.stringify({
          title,
          region,
          owner: user.uid,
          nConditions,
          useValidation,
          allowJSON,
          allowCSV,
          useSessionLimit,
          maxSessions,
          id,
        }),
      }
    );
    const infoFileData = await infoFileRes.json();

    // Guardar experimento en Firestore
    const batch = writeBatch(db);
    const experimentDoc = doc(db, "experiments", id);
    batch.set(experimentDoc, {
      title: title,
      dropboxFolder: folderPath,
      dropboxFile: `${folderPath}/info.json`,
      active: false,
      activeBase64: false,
      activeConditionAssignment: false,
      sessions: 0,
      limitSessions: useSessionLimit,
      maxSessions: maxSessions,
      id: id,
      owner: user.uid,
      nConditions: nConditions,
      currentCondition: 0,
      useValidation: useValidation,
      allowJSON: allowJSON,
      allowCSV: allowCSV,
      requiredFields: ["trial_type"],
    });
    const userDoc = doc(db, `users/${user.uid}`);
    batch.update(userDoc, {
      experiments: arrayUnion(id),
    });
    await batch.commit();
    Router.push(`/admin/${id}`);
  } catch (error) {
    setIsSubmitting(false);
    setDropboxError(true);
  }
}
