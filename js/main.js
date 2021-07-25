"use strict";

const producerVideo = document.querySelector(".producer>video");
const consumerVideo = document.querySelector(".consumer>video");

const producerPC = new RTCPeerConnection();
const consumerPC = new RTCPeerConnection();
producerPC.addEventListener("icecandidate", async (event) => {
    await consumerPC.addIceCandidate(event.candidate);
});
consumerPC.addEventListener("icecandidate", async (event) => {
    await producerPC.addIceCandidate(event.candidate);
});

console.log("producer video", producerVideo, ", consumer pc ", consumerPC);
console.log("consumer video", consumerVideo, ", producer pc ", producerPC);

const removeTransportCc = (sdp) => {
    return { type: sdp.type,
             sdp: sdp
                .sdp
                .split("\r\n")
                .filter(line => !(line.includes("transport-cc") || line.includes("http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01")))
                .join("\r\n") }
}  

const reproduceLowQualityVideo = async () => {
    console.log("Will reproduce underestimated bandwidth issue");

    const producedVideo = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
            width: { ideal: 4096 },
            height: { ideal: 2160 },
        },
    });
    producerVideo.srcObject = producedVideo;

    // Active video transceiver
    producerPC.addTransceiver(producedVideo.getVideoTracks()[0], {
        direction: "sendonly",
    });
    // Presence of 1 additional transceiver does not reproduce issue
    producerPC.addTransceiver('video', {
        direction: "inactive",
    });
    // But presence of 3+ video transceivers in one RTCPeerConnection reproduces 
    // bandwidth estimator issue, causing low quality of consumed video.
    // Low bandwidth could be confirmed by about:webrtc or by webrtc logs:
    // $> MOZ_LOG=webrtc_trace:5,jsep:5,transceiverimpl:5 R_LOG_DESTINATION=stderr ./mach run
    // In logs there will be 
    // (delay_based_bwe.cc:XXX): Long feedback delay detected, reducing BWE to YYYYY
    // The investigation so far narrowed down to the RTCP transport feedback handling code.
    // Single RTCP transport feedback is handled multiple times - liner to number of transceivers.
    // Send time history is erased when RTCP transport feedback processed first time,
    // Later processing of RTCP transport feedback will increase error consecutive_delayed_feedbacks_ 
    // counter in DelayBasedBwe eventually causing reduction of BWE.
    producerPC.addTransceiver('video', {
        direction: "inactive",
    });

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('no-transport-cc')) {
        const offer = await producerPC.createOffer();
        console.log("Original producer offer: ", offer.sdp);
        const patchedOffer = removeTransportCc(offer);
        console.log("Patched producer offer: ", patchedOffer.sdp);
        await producerPC.setLocalDescription(patchedOffer);
    } else {
        await producerPC.setLocalDescription();
    }

    console.log("Producer local description:", producerPC.localDescription.sdp);
    await consumerPC.setRemoteDescription(producerPC.localDescription);
    await consumerPC.setLocalDescription();
    await producerPC.setRemoteDescription(consumerPC.localDescription);

    consumerVideo.srcObject = new MediaStream([consumerPC.getTransceivers()[0].receiver.track]);

    console.log("Did reproduce underestimated bandwidth issue");
};

reproduceLowQualityVideo()