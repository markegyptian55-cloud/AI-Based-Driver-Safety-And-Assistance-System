"""
book_references.py — the verified reference list, IEEE format
==============================================================
Every entry here was read from the PDF itself, not from a filename.
Bibliographic fields that could not be confirmed from the document are
omitted rather than guessed: an incomplete-but-true entry is correctable,
an invented DOI is not.

Entries 9-12 are marked PENDING. They cover claims the book makes that the
supplied paper set does not support (RF-DETR, PERCLOS, sparsely annotated
object detection, and Faster R-CNN). They are real, verified works, but
they were not part of the author-supplied set, so they are held here
behind an explicit flag rather than silently merged into the bibliography.
Set INCLUDE_PENDING = True only on the author's instruction.
"""

INCLUDE_PENDING = False

# --- author-supplied set (8 papers, all read and verified) ---------------

REFERENCES = [
    'A. Mujtaba, G. Radchenko, M. Masana, and R. Prodan, "YawDD+: Frame-level '
    'annotations for accurate yawn recognition on edge platforms," Silicon '
    'Austria Labs, Graz University of Technology, and University of '
    'Innsbruck, 2025.',

    'M. Arava and D. M. Sundaram, "Integrating lightweight YOLOv5s and facial '
    '3D keypoints for enhanced fatigued-driving detection," PeerJ Computer '
    'Science, vol. 10, e2447, 2024.',

    'C. Chen, X. Liu, M. Zhou, Z. Li, Z. Du, and Y. Lin, "Lightweight and '
    'real-time driver fatigue detection based on MG-YOLOv8 with facial '
    'multi-feature fusion," Journal of Imaging, vol. 11, no. 11, p. 385, 2025.',

    'A. A. D. Go, F. Alzami, M. Naufal, H. Al Azies, S. Winarno, R. A. '
    'Pramunendar, R. A. Megantara, I. I. Maulana, and M. Arif, "Comprehensive '
    'benchmark of YOLOv11n, SSD MobileNet, CenterFace, YuNet, FastMTCNN, '
    'HaarCascade, and LBP for face detection in video based driver '
    'drowsiness," Building of Informatics, Technology and Science (BITS), '
    'vol. 7, no. 3, pp. 1775-1784, 2025.',

    'D. Herath, C. Abeyrathne, and P. Jayaweera, "Vision-based driver '
    'drowsiness monitoring: Comparative analysis of YOLOv5-v11 models," '
    'University of Ruhuna, Sri Lanka, 2025.',

    'F. Alzami, M. Naufal, R. S. Basuki, S. Winarno, H. Al Azies, S. L. '
    'Lutfi, and R. M. Brilianto, "Bayesian-optimized CLAHE for enhanced '
    'drowsiness detection in low-light conditions using time-distributed '
    'MobileNetV2-GRU architecture," Statistics, Optimization and Information '
    'Computing, vol. 151, pp. 274-294, 2026.',

    'L. Yusuf, M. Hamada, M. Hassan, and H. Kakudi, "Enhanced driver '
    'drowsiness detection model using multi-level features fusion and a '
    'long-short-term recurrent neural network," Engineering Proceedings, '
    'vol. 56, no. 1, p. 338, 2024.',

    'H. George and L. Rochit, "Advancing driver assistance systems and '
    'drowsiness detection: Overcoming challenges for enhanced road safety," '
    'TechRxiv preprint, 2025.',
]

# --- verified, held pending author approval ------------------------------

PENDING_REFERENCES = [
    'I. Robicheaux, P. Popov, et al., "RF-DETR: Neural architecture search '
    'for real-time detection transformers," arXiv:2511.09554, 2025.',

    'W. W. Wierwille, L. A. Ellsworth, S. S. Wreggit, R. J. Fairbanks, and '
    'C. L. Kirn, "Research on vehicle-based driver status/performance '
    'monitoring: Development, validation, and refinement of algorithms for '
    'detection of driver drowsiness," National Highway Traffic Safety '
    'Administration, Final Report DOT HS 808 247, 1994.',

    'Z. Zhang, X. Zhang, C. Peng, X. Xue, and J. Sun, "Solving '
    'missing-annotation object detection with background recalibration '
    'loss," arXiv:2002.05274, 2020.',

    'S. Ren, K. He, R. Girshick, and J. Sun, "Faster R-CNN: Towards real-time '
    'object detection with region proposal networks," in Advances in Neural '
    'Information Processing Systems (NeurIPS), 2015.',
]


def active_references():
    """The bibliography as it should appear in the built document."""
    refs = list(REFERENCES)
    if INCLUDE_PENDING:
        refs += PENDING_REFERENCES
    return refs


# Claims in the text that depend on a PENDING reference. Used by the
# builder to emit a visible marker rather than an unsupported assertion,
# so an unapproved citation can never silently become an uncited claim.
PENDING_TOPICS = {
    "rfdetr": "RF-DETR architecture",
    "perclos": "PERCLOS foundational definition",
    "saod": "sparsely annotated object detection",
    "fasterrcnn": "Faster R-CNN architecture",
}
